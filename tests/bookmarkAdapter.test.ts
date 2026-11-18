import { describe, expect, it } from 'vitest';
import {
  BookmarkTreeError,
  transformBookmarkTree,
} from '../src/adapters/bookmarkAdapter';
import type { NativeBookmarkNode } from '../src/types/bookmark';
import {
  makeStandardTree,
  makeTree,
  nativeBookmark,
  nativeFolder,
} from './fixtures/bookmarkTree';

describe('transformBookmarkTree', () => {
  it('区分系统根节点、书签栏、其他书签和移动设备书签', () => {
    const data = transformBookmarkTree(makeStandardTree());

    expect(data.root.id).toBe('0');
    expect(data.bookmarksBar.role).toBe('bookmarks-bar');
    expect(data.bookmarksBar.title).toBe('书签栏');
    expect(data.otherBookmarks.role).toBe('other-bookmarks');
    expect(data.mobileBookmarks?.role).toBe('mobile-bookmarks');
    expect(data.extraSections).toHaveLength(0);
    expect(data.summary).toEqual({
      bookmarkCount: 13,
      folderCount: 4,
      sectionCount: 3,
    });
  });

  it('把书签栏根目录网址转为常用网站，根目录文件夹转为分类', () => {
    const data = transformBookmarkTree(makeStandardTree());

    expect(data.bookmarksBar.directBookmarks.map((bookmark) => bookmark.title)).toEqual([
      'Google',
      'YouTube',
      'GitHub',
    ]);
    expect(data.bookmarksBar.folders.map((folder) => folder.title)).toEqual([
      'AI 工具',
      '开发工具',
      '娱乐',
    ]);
    expect(data.bookmarksBar.folders[0]?.children).toHaveLength(3);
    expect(data.bookmarksBar.folders[0]?.children[0]?.type).toBe('bookmark');
  });

  it('保留嵌套文件夹层级和多层子节点', () => {
    const tree = makeTree([
      nativeFolder('folder-level-1', '1', 0, '一级', [
        nativeBookmark('bm-root-level', 'folder-level-1', 0, '入口', 'https://example.com/'),
        nativeFolder('folder-level-2', 'folder-level-1', 1, '二级', [
          nativeFolder('folder-level-3', 'folder-level-2', 0, '三级', [
            nativeBookmark('bm-deep', 'folder-level-3', 0, '深层书签', 'https://deep.example/'),
          ]),
        ]),
      ]),
    ]);

    const data = transformBookmarkTree(tree);
    const levelOne = data.bookmarksBar.folders[0];
    expect(levelOne?.title).toBe('一级');
    expect(levelOne?.children[0]?.type).toBe('bookmark');

    const levelTwo = levelOne?.children[1];
    expect(levelTwo?.type).toBe('folder');
    if (levelTwo?.type !== 'folder') {
      throw new Error('测试数据应包含二级文件夹');
    }

    const levelThree = levelTwo.children[0];
    expect(levelThree?.type).toBe('folder');
    if (levelThree?.type !== 'folder') {
      throw new Error('测试数据应包含三级文件夹');
    }

    expect(levelThree.children[0]?.type).toBe('bookmark');
    expect(data.summary.folderCount).toBe(3);
    expect(data.summary.bookmarkCount).toBe(2);
  });

  it('即使 children 数组乱序，也按原生 index 保留排序', () => {
    const tree = makeTree(
      [
        nativeBookmark('bm-third', '1', 2, '第三', 'https://third.example/'),
        nativeBookmark('bm-first', '1', 0, '第一', 'https://first.example/'),
        nativeBookmark('bm-second', '1', 1, '第二', 'https://second.example/'),
        nativeFolder('folder-second', '1', 4, '后置分类', [
          nativeBookmark('bm-child-second', 'folder-second', 1, '子项二', 'https://b.example/'),
          nativeBookmark('bm-child-first', 'folder-second', 0, '子项一', 'https://a.example/'),
        ]),
        nativeFolder('folder-first', '1', 3, '前置分类'),
      ],
      [],
      [
        nativeBookmark('bm-mobile-second', '3', 1, '移动二', 'https://m2.example/'),
        nativeBookmark('bm-mobile-first', '3', 0, '移动一', 'https://m1.example/'),
      ],
    );

    const data = transformBookmarkTree(tree);

    expect(data.bookmarksBar.directBookmarks.map((bookmark) => bookmark.title)).toEqual([
      '第一',
      '第二',
      '第三',
    ]);
    expect(data.bookmarksBar.folders.map((folder) => folder.title)).toEqual([
      '前置分类',
      '后置分类',
    ]);

    const childFolder = data.bookmarksBar.folders[1];
    expect(childFolder?.children.map((node) => node.title)).toEqual(['子项一', '子项二']);
    expect(data.mobileBookmarks?.directBookmarks.map((bookmark) => bookmark.title)).toEqual([
      '移动一',
      '移动二',
    ]);
  });

  it('支持空书签栏和空的其他书签', () => {
    const data = transformBookmarkTree(makeTree([]));

    expect(data.bookmarksBar.directBookmarks).toHaveLength(0);
    expect(data.bookmarksBar.folders).toHaveLength(0);
    expect(data.otherBookmarks.children).toHaveLength(0);
    expect(data.mobileBookmarks).toBeNull();
    expect(data.summary).toEqual({
      bookmarkCount: 0,
      folderCount: 0,
      sectionCount: 2,
    });
  });

  it('支持只有网址、没有文件夹的书签栏', () => {
    const tree = makeTree([
      nativeBookmark('bm-a', '1', 0, 'A', 'https://a.example/'),
      nativeBookmark('bm-b', '1', 1, 'B', 'https://b.example/'),
    ]);

    const data = transformBookmarkTree(tree);

    expect(data.bookmarksBar.directBookmarks).toHaveLength(2);
    expect(data.bookmarksBar.folders).toHaveLength(0);
    expect(data.summary.folderCount).toBe(0);
  });

  it('支持只有文件夹、没有根目录网址的书签栏，并保留空文件夹', () => {
    const tree = makeTree([
      nativeFolder('folder-empty', '1', 0, '空分类'),
      nativeFolder('folder-filled', '1', 1, '有内容', [
        nativeBookmark('bm-only', 'folder-filled', 0, '唯一书签', 'https://only.example/'),
      ]),
    ]);

    const data = transformBookmarkTree(tree);

    expect(data.bookmarksBar.directBookmarks).toHaveLength(0);
    expect(data.bookmarksBar.folders).toHaveLength(2);
    expect(data.bookmarksBar.folders[0]?.children).toHaveLength(0);
    expect(data.bookmarksBar.folders[0]?.title).toBe('空分类');
    expect(data.summary.folderCount).toBe(2);
  });

  it('不丢弃其他书签，并保留其原生目录层级', () => {
    const tree = makeTree([], [
      nativeBookmark('bm-other-direct', '2', 0, '其他直达', 'https://other.example/'),
      nativeFolder('folder-other', '2', 1, '其他分类', [
        nativeBookmark('bm-other-child', 'folder-other', 0, '其他子项', 'https://child.example/'),
      ]),
    ]);

    const data = transformBookmarkTree(tree);

    expect(data.otherBookmarks.directBookmarks.map((bookmark) => bookmark.title)).toEqual([
      '其他直达',
    ]);
    expect(data.otherBookmarks.folders[0]?.title).toBe('其他分类');
    expect(data.otherBookmarks.folders[0]?.children[0]?.title).toBe('其他子项');
  });

  it('空树返回安全的空展示模型，而不是生成分类', () => {
    const data = transformBookmarkTree([]);

    expect(data.root.id).toBe('0');
    expect(data.bookmarksBar.children).toHaveLength(0);
    expect(data.otherBookmarks.children).toHaveLength(0);
    expect(data.mobileBookmarks).toBeNull();
    expect(data.summary.bookmarkCount).toBe(0);
  });

  it('保留无法识别的根节点，避免静默丢数据', () => {
    const tree: NativeBookmarkNode[] = [
      {
        id: '0',
        title: '',
        children: [
          { id: '1', parentId: '0', index: 0, title: '书签栏', children: [] },
          { id: '2', parentId: '0', index: 1, title: '其他书签', children: [] },
          {
            id: 'custom-root',
            parentId: '0',
            index: 2,
            title: '额外根节点',
            children: [
              nativeBookmark('bm-extra', 'custom-root', 0, '额外书签', 'https://extra.example/'),
            ],
          },
        ],
      },
    ];

    const data = transformBookmarkTree(tree);

    expect(data.mobileBookmarks).toBeNull();
    expect(data.extraSections).toHaveLength(1);
    expect(data.extraSections[0]?.role).toBe('unknown');
    expect(data.extraSections[0]?.title).toBe('额外根节点');
    expect(data.summary.sectionCount).toBe(3);
    expect(data.summary.bookmarkCount).toBe(1);
  });

  it('在固定 ID 缺失时按根节点顺序兼容识别三个区域', () => {
    const tree: NativeBookmarkNode[] = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: 'bar-custom',
            parentId: '0',
            index: 0,
            title: 'Bar',
            children: [nativeBookmark('bm-a', 'bar-custom', 0, 'A', 'https://a.example/')],
          },
          { id: 'other-custom', parentId: '0', index: 1, title: 'Other', children: [] },
          { id: 'mobile-custom', parentId: '0', index: 2, title: 'Mobile', children: [] },
        ],
      },
    ];

    const data = transformBookmarkTree(tree);

    expect(data.bookmarksBar.title).toBe('Bar');
    expect(data.otherBookmarks.title).toBe('Other');
    expect(data.mobileBookmarks?.title).toBe('Mobile');
    expect(data.extraSections).toHaveLength(0);
  });

  it('大量网址和分类仍能完整转换', () => {
    const folders = Array.from({ length: 20 }, (_, folderIndex) =>
      nativeFolder(
        `folder-${folderIndex}`,
        '1',
        folderIndex,
        `分类 ${folderIndex}`,
        Array.from({ length: 50 }, (_, bookmarkIndex) =>
          nativeBookmark(
            `bm-${folderIndex}-${bookmarkIndex}`,
            `folder-${folderIndex}`,
            bookmarkIndex,
            `书签 ${folderIndex}-${bookmarkIndex}`,
            `https://example.com/${folderIndex}/${bookmarkIndex}`,
          ),
        ),
      ),
    );

    const data = transformBookmarkTree(makeTree(folders));

    expect(data.bookmarksBar.folders).toHaveLength(20);
    expect(data.summary.bookmarkCount).toBe(1000);
    expect(data.summary.folderCount).toBe(20);
  });

  it('遇到多个根节点或根节点网址时显式报错', () => {
    expect(() =>
      transformBookmarkTree([
        { id: '0', title: '', children: [] },
        { id: '0-duplicate', title: '', children: [] },
      ]),
    ).toThrow(BookmarkTreeError);

    expect(() =>
      transformBookmarkTree([
        {
          id: '0',
          title: '',
          url: 'https://invalid-root.example/',
          children: [],
        },
      ]),
    ).toThrow('书签树根节点不能是网址');
  });
});
