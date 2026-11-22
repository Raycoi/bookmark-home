import type { RecentBookmark } from '../types/search';
import { getErrorMessage } from '../utils/errors';
import { getNavigableUrl } from '../utils/navigation';
import { t } from '../i18n';

export const RECENT_BOOKMARKS_STORAGE_KEY = 'bookmarkHome.recentBookmarks';
export const RECENT_BOOKMARKS_LIMIT = 6;

/**
 * 串行化「读-改-写」：并发打开两个书签时，后一次写入必须基于前一次的结果，
 * 否则两次读取都拿到旧数组，最后一次写入会覆盖前一次记录。
 *
 * 与 healthCacheService 的 writeChain 相同，只在本页面上下文内生效；
 * 多窗口同时写入仍依赖 storage 的最终一次写入。
 */
let writeChain: Promise<void> = Promise.resolve();

type RecentBookmarkInput = Omit<RecentBookmark, 'openedAt'> & {
  openedAt?: number;
};

function hasLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function validRecent(value: unknown): value is RecentBookmark {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<RecentBookmark>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.url === 'string' &&
    typeof item.folderPath === 'string' &&
    typeof item.openedAt === 'number' &&
    Boolean(getNavigableUrl(item.url))
  );
}

export function normalizeRecentBookmarks(value: unknown): RecentBookmark[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(validRecent)
    .slice(0, RECENT_BOOKMARKS_LIMIT)
    .map((item) => ({ ...item }));
}

export async function readRecentBookmarks(): Promise<RecentBookmark[]> {
  if (!hasLocalStorage()) {
    return [];
  }

  try {
    const result = await chrome.storage.local.get(RECENT_BOOKMARKS_STORAGE_KEY);
    return normalizeRecentBookmarks(result[RECENT_BOOKMARKS_STORAGE_KEY]);
  } catch (error) {
    console.warn('[Bookmark Home] 读取最近书签失败', getErrorMessage(error));
    return [];
  }
}

export async function recordRecentBookmark(
  input: RecentBookmarkInput,
): Promise<void> {
  if (!hasLocalStorage() || !getNavigableUrl(input.url)) {
    return;
  }

  const operation = writeChain.then(async () => {
    try {
      const current = await readRecentBookmarks();
      const next: RecentBookmark = {
        id: input.id,
        title: input.title.trim() || t('common.unnamedBookmark'),
        url: input.url,
        folderPath: input.folderPath,
        openedAt: input.openedAt ?? Date.now(),
      };
      const deduped = current.filter(
        (item) => item.id !== next.id && item.url !== next.url,
      );
      await chrome.storage.local.set({
        [RECENT_BOOKMARKS_STORAGE_KEY]: [next, ...deduped].slice(
          0,
          RECENT_BOOKMARKS_LIMIT,
        ),
      });
    } catch (error) {
      console.warn('[Bookmark Home] 保存最近书签失败', getErrorMessage(error));
    }
  });

  writeChain = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export async function clearRecentBookmarks(): Promise<void> {
  if (!hasLocalStorage()) {
    return;
  }

  try {
    await chrome.storage.local.remove(RECENT_BOOKMARKS_STORAGE_KEY);
  } catch (error) {
    console.warn('[Bookmark Home] 清理最近书签失败', getErrorMessage(error));
  }
}
