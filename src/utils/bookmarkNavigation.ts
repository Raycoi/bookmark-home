import { t } from '../i18n';

/** 打开 Chrome 书签管理器并定位到指定文件夹/根节点。 */
export function buildBookmarkManagerUrl(parentId: string): string {
  return `chrome://bookmarks/?id=${encodeURIComponent(parentId)}`;
}

export interface BookmarkTabsApi {
  create(createProperties: { url: string }): Promise<unknown>;
}

/**
 * 通过 tabs API 打开 Chrome 书签管理器。
 *
 * 不申请 `tabs` 权限；`tabs.create` 本身不需要该权限。
 */
export async function openBookmarkManagerAt(
  parentId: string,
  tabsApi?: BookmarkTabsApi,
): Promise<void> {
  const api =
    tabsApi ??
    (typeof chrome !== 'undefined' && chrome.tabs
      ? (chrome.tabs as unknown as BookmarkTabsApi)
      : null);

  if (!api) {
    throw new Error(t('bookmark.error.managerUnavailable'));
  }

  await api.create({ url: buildBookmarkManagerUrl(parentId) });
}
