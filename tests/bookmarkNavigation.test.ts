import { describe, expect, it, vi } from 'vitest';
import {
  buildBookmarkManagerUrl,
  openBookmarkManagerAt,
  type BookmarkTabsApi,
} from '../src/utils/bookmarkNavigation';

describe('Chrome 书签管理器定位 URL', () => {
  it('按父级文件夹 ID 生成定位地址', () => {
    expect(buildBookmarkManagerUrl('3')).toBe('chrome://bookmarks/?id=3');
    expect(buildBookmarkManagerUrl('folder a')).toBe(
      'chrome://bookmarks/?id=folder%20a',
    );
  });

  it('调用 tabs.create 打开定位地址', async () => {
    const create = vi.fn(async () => ({ id: 1 }));
    const tabsApi: BookmarkTabsApi = { create };

    await openBookmarkManagerAt('3', tabsApi);

    expect(create).toHaveBeenCalledWith({ url: 'chrome://bookmarks/?id=3' });
  });

  it('没有 tabs API 时明确失败', async () => {
    await expect(openBookmarkManagerAt('3')).rejects.toThrow(
      '当前环境不支持打开书签管理器',
    );
  });
});
