import {
  DEFAULT_SEARCH_ENGINE_ID,
  isSearchEngineId,
  type SearchEngineId,
} from '../config/searchEngines';
import { getErrorMessage } from '../utils/errors';

const SEARCH_ENGINE_STORAGE_KEY = 'bookmarkHome.searchEngineId';

function hasSyncStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
}

/**
 * 读取用户选择过的搜索引擎。
 *
 * 只保存一个偏好字段，绝不把书签数据写入 storage。
 * 存储不可用或内容非法时回退到默认引擎，不阻断主页使用。
 */
export async function readSearchEnginePreference(): Promise<SearchEngineId> {
  if (!hasSyncStorage()) {
    return DEFAULT_SEARCH_ENGINE_ID;
  }

  try {
    const result = await chrome.storage.sync.get(SEARCH_ENGINE_STORAGE_KEY);
    const stored = result[SEARCH_ENGINE_STORAGE_KEY];
    return typeof stored === 'string' && isSearchEngineId(stored)
      ? stored
      : DEFAULT_SEARCH_ENGINE_ID;
  } catch (error) {
    console.warn('[Bookmark Home] 读取搜索引擎偏好失败', getErrorMessage(error));
    return DEFAULT_SEARCH_ENGINE_ID;
  }
}

/** 保存搜索引擎偏好；失败只记录警告，不影响当前搜索。 */
export async function saveSearchEnginePreference(id: SearchEngineId): Promise<void> {
  if (!hasSyncStorage()) {
    return;
  }

  try {
    await chrome.storage.sync.set({ [SEARCH_ENGINE_STORAGE_KEY]: id });
  } catch (error) {
    console.warn('[Bookmark Home] 保存搜索引擎偏好失败', getErrorMessage(error));
  }
}
