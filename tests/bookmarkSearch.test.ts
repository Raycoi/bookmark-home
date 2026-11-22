import { describe, expect, it } from 'vitest';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import { collectSearchableBookmarks, searchBookmarks } from '../src/utils/bookmarkSearch';

const data = transformBookmarkTree([
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: '书签栏',
        children: [
          {
            id: 'f-dev',
            title: '开发工具',
            children: [
              {
                id: 'b-deepseek',
                title: 'DeepSeek',
                url: 'https://deepseek.com',
              },
              {
                id: 'b-github',
                title: 'GitHub',
                url: 'https://github.com',
              },
            ],
          },
          {
            id: 'b-mdn',
            title: 'MDN',
            url: 'https://developer.mozilla.org',
          },
        ],
      },
      {
        id: '2',
        title: '其他书签',
        children: [],
      },
    ],
  },
]);

describe('本地书签搜索', () => {
  it('展开文件夹路径并过滤不可导航地址', () => {
    const bookmarks = collectSearchableBookmarks(data);
    const deepseek = bookmarks.find((item) => item.id === 'b-deepseek');
    expect(deepseek?.folderPath).toBe('书签栏 / 开发工具');
    expect(bookmarks.every((item) => item.url.startsWith('https://'))).toBe(true);
  });

  it('标题前缀优先于标题包含和 URL 匹配', () => {
    const bookmarks = collectSearchableBookmarks(data);
    const results = searchBookmarks(bookmarks, 'deep', 5);
    expect(results.map((item) => item.id)).toEqual(['b-deepseek']);
  });

  it('匹配 URL 和文件夹名，空查询返回空结果', () => {
    const bookmarks = collectSearchableBookmarks(data);
    expect(searchBookmarks(bookmarks, 'github')[0]?.id).toBe('b-github');
    expect(
      searchBookmarks(bookmarks, '开发工具')
        .map((item) => item.id)
        .sort(),
    ).toEqual(['b-deepseek', 'b-github']);
    expect(searchBookmarks(bookmarks, '   ')).toEqual([]);
  });

  it('最多返回指定条数', () => {
    const bookmarks = collectSearchableBookmarks(data);
    expect(searchBookmarks(bookmarks, 'https', 2)).toHaveLength(2);
  });
});
