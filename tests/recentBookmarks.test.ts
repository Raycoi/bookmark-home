import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_BOOKMARKS_LIMIT,
  RECENT_BOOKMARKS_STORAGE_KEY,
  normalizeRecentBookmarks,
  recordRecentBookmark,
} from '../src/services/recentBookmarksService';

class MemoryStorage {
  data: Record<string, unknown> = {};
  writes = 0;

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.data[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writes += 1;
    Object.assign(this.data, items);
  }
}

function stubLocalStorage(storage: MemoryStorage): void {
  vi.stubGlobal('chrome', { storage: { local: storage } });
}

function readStored(storage: MemoryStorage) {
  return normalizeRecentBookmarks(storage.data[RECENT_BOOKMARKS_STORAGE_KEY]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('最近书签存储规范化', () => {
  it('过滤无效项并限制为 6 条', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `b-${index}`,
      title: `书签 ${index}`,
      url: `https://example.com/${index}`,
      folderPath: '书签栏',
      openedAt: index,
    }));
    expect(normalizeRecentBookmarks(items)).toHaveLength(6);
  });

  it('拒绝非 HTTP/HTTPS 和格式错误的记录', () => {
    const result = normalizeRecentBookmarks([
      {
        id: 'bad',
        title: 'Bad',
        url: 'javascript:alert(1)',
        folderPath: '',
        openedAt: 1,
      },
      {
        id: 'good',
        title: 'Good',
        url: 'https://example.com',
        folderPath: '书签栏',
        openedAt: 2,
      },
      null,
    ]);
    expect(result.map((item) => item.id)).toEqual(['good']);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizeRecentBookmarks(null)).toEqual([]);
    expect(normalizeRecentBookmarks({})).toEqual([]);
  });
});

describe('最近书签并发写入', () => {
  it('并发记录两个书签时串行化读-改-写，两条都保留', async () => {
    const storage = new MemoryStorage();
    stubLocalStorage(storage);

    await Promise.all([
      recordRecentBookmark({
        id: 'a',
        title: 'A',
        url: 'https://a.example/',
        folderPath: '书签栏',
        openedAt: 2,
      }),
      recordRecentBookmark({
        id: 'b',
        title: 'B',
        url: 'https://b.example/',
        folderPath: '书签栏',
        openedAt: 1,
      }),
    ]);

    expect(readStored(storage).map((item) => item.id)).toEqual(['b', 'a']);
    expect(storage.writes).toBe(2);
  });

  it('并发写入仍然按去重规则合并同一书签', async () => {
    const storage = new MemoryStorage();
    stubLocalStorage(storage);

    await Promise.all([
      recordRecentBookmark({
        id: 'a',
        title: '旧标题',
        url: 'https://a.example/',
        folderPath: '书签栏',
        openedAt: 1,
      }),
      recordRecentBookmark({
        id: 'a',
        title: '新标题',
        url: 'https://a.example/',
        folderPath: '书签栏',
        openedAt: 2,
      }),
    ]);

    const stored = readStored(storage);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.title).toBe('新标题');
  });

  it('并发写入后仍保留最近 6 条的上限', async () => {
    const storage = new MemoryStorage();
    stubLocalStorage(storage);

    await Promise.all(
      Array.from({ length: RECENT_BOOKMARKS_LIMIT + 2 }, (_, index) =>
        recordRecentBookmark({
          id: `b-${index}`,
          title: `书签 ${index}`,
          url: `https://example.com/${index}`,
          folderPath: '书签栏',
          openedAt: index,
        }),
      ),
    );

    expect(readStored(storage)).toHaveLength(RECENT_BOOKMARKS_LIMIT);
    expect(storage.writes).toBe(RECENT_BOOKMARKS_LIMIT + 2);
  });
});
