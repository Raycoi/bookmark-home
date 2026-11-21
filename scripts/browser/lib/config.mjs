import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const SHOT_DIR = path.join(ROOT, '.tmp', 'browser-shots');
export const STATE_FILE = path.join(ROOT, '.e2e-state.json');

mkdirSync(SHOT_DIR, { recursive: true });

export async function getExtensionId() {
  const fromEnvironment = process.env.E2E_EXTENSION_ID?.trim();
  if (fromEnvironment) {
    return fromEnvironment;
  }

  try {
    const state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (typeof state.extensionId === 'string' && state.extensionId) {
      return state.extensionId;
    }
  } catch {
    // 下面给出可操作的运行提示。
  }

  throw new Error(
    '没有找到扩展 ID：先运行 node scripts/browser/load-extension.mjs，' +
      '或设置 E2E_EXTENSION_ID 环境变量。',
  );
}

export async function getExtensionUrl() {
  return `chrome-extension://${await getExtensionId()}/newtab.html`;
}
