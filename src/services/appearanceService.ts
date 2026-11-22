import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  type AppearanceSettings,
} from '../types/appearance';
import { getErrorMessage } from '../utils/errors';

export const APPEARANCE_STORAGE_KEY = 'bookmarkHome.appearance';

function hasLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function readAppearance(): Promise<AppearanceSettings> {
  if (!hasLocalStorage()) {
    return { ...DEFAULT_APPEARANCE };
  }

  try {
    const result = await chrome.storage.local.get(APPEARANCE_STORAGE_KEY);
    return normalizeAppearance(result[APPEARANCE_STORAGE_KEY]);
  } catch (error) {
    console.warn('[Bookmark Home] 读取外观设置失败', getErrorMessage(error));
    return { ...DEFAULT_APPEARANCE };
  }
}

export async function saveAppearance(
  appearance: AppearanceSettings,
): Promise<void> {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [APPEARANCE_STORAGE_KEY]: normalizeAppearance(appearance),
    });
  } catch (error) {
    console.warn('[Bookmark Home] 保存外观设置失败', getErrorMessage(error));
  }
}
