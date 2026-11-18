import { describe, expect, it } from 'vitest';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import {
  buildFolderTree,
  collectFolderSubtreeIds,
  flattenFolderOptions,
  formatFolderOption,
  getFolderChildren,
  getNodeTitle,
  summarizeFolderContents,
} from '../src/utils/folders';
import {
  makeStandardTree,
  makeTree,
  nativeBookmark,
  nativeFolder,
} from './fixtures/bookmarkTree';

function buildNestedData() {
  return transformBookmarkTree(
    makeTree([
      nativeFolder('folder-parent', '1', 0, '父文件夹', [
        nativeBookmark('bm-one', 'folder-parent', 0, '书签一', 'https://one.example/'),
        nativeFolder('folder-child', 'folder-parent', 1, '子文件夹', [
          nativeBookmark(
            'bm-two',
            'folder-child',
            0,
            '书签二',
            'https://two.example/',
          ),
        ]),
      ]),
      nativeFolder('folder-empty', '1', 1, '空文件夹'),
    ]),
  );
}

describe('文件夹工具', () => {
  it('构建只包含文件夹的目标树，并保留书签栏和其他书签根节点', () => {
    const data = buildNestedData();
    const tree = buildFolderTree(data);

    expect(tree.map((root) => root.id)).toEqual(['1', '2']);
    expect(tree[0]?.isSection).toBe(true);
    expect(tree[0]?.children.map((folder) => folder.title)).toEqual([
      '父文件夹',
      '空文件夹',
    ]);
    expect(tree[0]?.children[0]?.children[0]?.title).toBe('子文件夹');
    expect(tree[0]?.children[0]?.children[0]?.children).toEqual([]);
  });

  it('排除文件夹自身和全部后代，防止循环目标', () => {
    const data = buildNestedData();
    const tree = buildFolderTree(data, new Set(['folder-parent']));
    const flattened = flattenFolderOptions(tree);

    expect(flattened.some((option) => option.id === 'folder-parent')).toBe(false);
    expect(flattened.some((option) => option.id === 'folder-child')).toBe(false);
    expect(flattened.some((option) => option.id === 'folder-empty')).toBe(true);
  });

  it('展平顺序与层级缩进正确', () => {
    const tree = buildFolderTree(buildNestedData());
    const flattened = flattenFolderOptions(tree);

    expect(flattened.map((option) => option.id)).toEqual([
      '1',
      'folder-parent',
      'folder-child',
      'folder-empty',
      '2',
    ]);
    expect(flattened.map((option) => option.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(formatFolderOption(flattened[2]!)).toBe('　　子文件夹');
  });

  it('收集文件夹自身及全部后代 ID', () => {
    const data = buildNestedData();
    const parent = data.bookmarksBar.folders[0]!;
    expect([...collectFolderSubtreeIds(parent)].sort()).toEqual([
      'folder-child',
      'folder-parent',
    ]);
  });

  it('根据文件夹 ID 查找直接子节点', () => {
    const data = buildNestedData();
    const children = getFolderChildren(data, 'folder-parent');

    expect(children?.map((node) => node.id)).toEqual(['bm-one', 'folder-child']);
    expect(getFolderChildren(data, 'missing')).toBeNull();
  });

  it('统计文件夹内全部网址和子文件夹', () => {
    const data = buildNestedData();
    const parent = data.bookmarksBar.folders[0]!;

    expect(summarizeFolderContents(parent)).toEqual({
      bookmarkCount: 2,
      folderCount: 1,
    });
  });

  it('为无名称节点提供回退标题', () => {
    const data = buildNestedData();
    const empty = data.bookmarksBar.folders[1]!;
    const bookmark = data.bookmarksBar.folders[0]!.children[0]!;

    expect(getNodeTitle(empty)).toBe('空文件夹');
    expect(getNodeTitle(bookmark)).toBe('书签一');
  });

  it('空数据返回空树', () => {
    expect(buildFolderTree(null)).toEqual([]);
  });

  it('标准书签树中的其他书签也可以作为目标根节点', () => {
    const data = transformBookmarkTree(makeStandardTree());
    const tree = buildFolderTree(data);
    expect(tree[1]?.title).toBe('其他书签');
    expect(tree[1]?.children.some((folder) => folder.title === '待读')).toBe(true);
  });
});
