import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT_DIR = path.join(ROOT, '.output');
const DIST_DIR = path.join(OUTPUT_DIR, 'chrome-mv3');
const PACKAGE_FILE = path.join(ROOT, 'package.json');
const REPORT_FILE = path.join(OUTPUT_DIR, 'build-report.json');
const EXPECTED_PERMISSIONS = ['alarms', 'bookmarks', 'favicon', 'storage'];
const FORBIDDEN_ZIP_SEGMENTS = [
  'node_modules',
  '.git',
  '.github',
  '.wxt',
  '.tmp',
  'tests',
  'test',
  'src',
  'scripts',
  'docs',
  'public',
  'coverage',
];

function fail(message, failures) {
  failures.push(message);
}

function normalizeEntries(archive) {
  return Object.keys(archive)
    .filter((name) => !name.endsWith('/'))
    .sort();
}

function isForbidden(name) {
  const segments = name.split('/');
  if (segments.some((segment) => FORBIDDEN_ZIP_SEGMENTS.includes(segment))) {
    return true;
  }
  return (
    name === '.e2e-state.json' ||
    name.endsWith('.map') ||
    name.endsWith('.log') ||
    name === 'package.json' ||
    name === 'pnpm-lock.yaml' ||
    name === '.npmrc'
  );
}

async function walk(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path.join(directory, entry.name), childRelative)));
    } else {
      files.push(childRelative);
    }
  }
  return files;
}

const pkg = JSON.parse(await readFile(PACKAGE_FILE, 'utf8'));
const version = pkg.version;
const zipPath = path.join(OUTPUT_DIR, `bookmark-home-${version}-chrome.zip`);
const failures = [];

let manifest;
let manifestText;
try {
  manifestText = await readFile(path.join(DIST_DIR, 'manifest.json'));
  manifest = JSON.parse(manifestText.toString('utf8'));
} catch (error) {
  fail(`无法读取构建后的 manifest.json：${error.message}`, failures);
}

let zipBytes;
try {
  zipBytes = await readFile(zipPath);
} catch (error) {
  fail(`无法读取 ZIP：${error.message}`, failures);
}

let zipEntries = [];
let zipManifest = null;
if (zipBytes) {
  try {
    const archive = unzipSync(new Uint8Array(zipBytes));
    const entries = normalizeEntries(archive);
    zipEntries = entries;
    const manifestEntry = entries.find((entry) => entry === 'manifest.json');
    if (!manifestEntry) {
      fail('ZIP 根目录缺少 manifest.json', failures);
    } else {
      zipManifest = JSON.parse(strFromU8(archive[manifestEntry]));
    }
    if (entries.some((entry) => entry.startsWith('bookmark-home/'))) {
      fail('ZIP 出现外层项目文件夹', failures);
    }
    for (const forbidden of entries.filter(isForbidden)) {
      fail(`ZIP 包含不应发布的文件：${forbidden}`, failures);
    }
    for (const required of [
      'background.js',
      'newtab.html',
      'manifest.json',
    ]) {
      if (!entries.includes(required)) {
        fail(`ZIP 缺少根文件：${required}`, failures);
      }
    }
    for (const prefix of ['icon/', 'assets/', 'chunks/']) {
      if (!entries.some((entry) => entry.startsWith(prefix))) {
        fail(`ZIP 缺少资源目录：${prefix}`, failures);
      }
    }
  } catch (error) {
    fail(`无法解析 ZIP：${error.message}`, failures);
  }
}

if (manifest) {
  try {
    const distFiles = await walk(DIST_DIR);
    for (const forbidden of distFiles.filter(isForbidden)) {
      fail(`构建目录包含不应发布的文件：${forbidden}`, failures);
    }
  } catch (error) {
    fail(`无法读取构建目录：${error.message}`, failures);
  }

  if (manifest.manifest_version !== 3) {
    fail('manifest.json 不是 Manifest V3', failures);
  }
  if (manifest.version !== version) {
    fail(
      `manifest 版本 ${manifest.version} 与 package.json ${version} 不一致`,
      failures,
    );
  }
  const permissions = [...(manifest.permissions ?? [])].sort();
  if (JSON.stringify(permissions) !== JSON.stringify(EXPECTED_PERMISSIONS)) {
    fail(`权限不符合预期：${permissions.join(',')}`, failures);
  }
  if (
    JSON.stringify(manifest.host_permissions ?? []) !==
    JSON.stringify(['<all_urls>'])
  ) {
    fail('host_permissions 不是 <all_urls>', failures);
  }
  if (manifest.background?.service_worker !== 'background.js') {
    fail('background.service_worker 不是 background.js', failures);
  }
  if (manifest.chrome_url_overrides?.newtab !== 'newtab.html') {
    fail('chrome_url_overrides.newtab 不是 newtab.html', failures);
  }
  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    try {
      await stat(path.join(DIST_DIR, iconPath));
    } catch {
      fail(`缺少图标 ${size}: ${iconPath}`, failures);
    }
  }
  if (zipManifest && JSON.stringify(zipManifest) !== JSON.stringify(manifest)) {
    fail('ZIP 内 manifest 与构建目录不一致', failures);
  }
}

if (zipBytes) {
  const report = {
    ok: failures.length === 0,
    version,
    zip: path.relative(ROOT, zipPath).replaceAll('\\', '/'),
    zipBytes: zipBytes.byteLength,
    zipKB: Math.round((zipBytes.byteLength / 1024) * 100) / 100,
    sha256: createHash('sha256').update(zipBytes).digest('hex'),
    zipEntryCount: zipEntries.length,
    topLevel: [...new Set(zipEntries.map((entry) => entry.split('/')[0]))].sort(),
    manifest: manifest
      ? {
          manifestVersion: manifest.manifest_version,
          version: manifest.version,
          permissions: manifest.permissions,
          hostPermissions: manifest.host_permissions,
          serviceWorker: manifest.background?.service_worker,
          newtab: manifest.chrome_url_overrides?.newtab,
        }
      : null,
    failures,
  };
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (process.argv.includes('--summary')) {
    const lines = [
      '### Extension build verification',
      '',
      `- Version: \`${report.version}\``,
      `- ZIP: \`${report.zip}\``,
      `- Size: \`${report.zipBytes}\` bytes (${report.zipKB} KB)`,
      `- SHA-256: \`${report.sha256}\``,
      `- ZIP entries: \`${report.zipEntryCount}\``,
      `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    ];
    console.log(lines.join('\n'));
  }

  console.log(JSON.stringify(report, null, 2));
}

if (!zipBytes || failures.length > 0) {
  if (failures.length > 0) {
    console.error('构建产物检查失败：');
    for (const message of failures) {
      console.error(`- ${message}`);
    }
  }
  process.exitCode = 1;
}
