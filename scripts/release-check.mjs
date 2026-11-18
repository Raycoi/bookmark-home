import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PACKAGE_FILE = path.join(ROOT, 'package.json');
const CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');
const REPORT_FILE = path.join(ROOT, '.output', 'build-report.json');
const NOTES_FILE = path.join(ROOT, '.output', 'release-notes.md');

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '';
const tagMatch = /^v(\d+\.\d+\.\d+)$/.exec(tag);
if (!tagMatch) {
  console.error(`发布 Tag 必须形如 v0.1.0，当前为：${tag || '(空)'}`);
  process.exit(1);
}

const version = tagMatch[1];
const pkg = JSON.parse(await readFile(PACKAGE_FILE, 'utf8'));
if (pkg.version !== version) {
  console.error(
    `Tag ${tag} 与 package.json 版本 ${pkg.version} 不一致。请先统一版本号。`,
  );
  process.exit(1);
}

let changelog;
try {
  changelog = await readFile(CHANGELOG_FILE, 'utf8');
} catch (error) {
  console.error(`无法读取 CHANGELOG.md：${error.message}`);
  process.exit(1);
}

const heading = new RegExp(
  `^## \\[${version.replaceAll('.', '\\.')}\\][^\\n]*\\n`,
  'm',
);
const match = heading.exec(changelog);
if (!match) {
  console.error(`CHANGELOG.md 中缺少版本 ${version} 的发布记录。`);
  process.exit(1);
}

const bodyStart = match.index + match[0].length;
const rest = changelog.slice(bodyStart);
const nextHeading = rest.search(/^## /m);
const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
if (!body) {
  console.error(`CHANGELOG.md 中版本 ${version} 的发布记录为空。`);
  process.exit(1);
}

let report = null;
try {
  report = JSON.parse(await readFile(REPORT_FILE, 'utf8'));
} catch {
  console.error('缺少 .output/build-report.json，请先执行构建和产物校验。');
  process.exit(1);
}
if (!report.ok || report.version !== version) {
  console.error('构建产物校验未通过或版本不匹配，拒绝生成发布说明。');
  process.exit(1);
}

const notes = [
  `## Bookmark Home ${tag}`,
  '',
  body,
  '',
  '## 安装',
  '',
  '1. 下载下方 ZIP，并解压到本地目录。',
  '2. 打开 `chrome://extensions`，开启“开发者模式”。',
  '3. 点击“加载已解压的扩展程序”，选择解压后的目录。',
  '4. 打开新标签页开始使用。',
  '',
  '## 构建校验',
  '',
  `- 版本：\`${report.version}\``,
  `- ZIP：\`${report.zip}\``,
  `- 大小：\`${report.zipBytes}\` 字节`,
  `- SHA-256：\`${report.sha256}\``,
  '',
  '> GitHub Release 只代表源码发布，不代表已经上架 Chrome Web Store。',
  '',
].join('\n');

await writeFile(NOTES_FILE, notes, 'utf8');
console.log(`Release notes 已写入 ${path.relative(ROOT, NOTES_FILE)}`);
console.log(notes);
