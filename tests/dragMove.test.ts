import { describe, expect, it } from 'vitest';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import { computeDropIndex } from '../src/utils/dragMove';
import {
  makeTree,
  nativeBookmark,
  nativeFolder,
} from './fixtures/bookmarkTree';

function siblings() {
  const data = transformBookmarkTree(
    makeTree([
      nativeBookmark('a', '1', 0, 'A', 'https://a.example/'),
      nativeBookmark('b', '1', 1, 'B', 'https://b.example/'),
      nativeBookmark('c', '1', 2, 'C', 'https://c.example/'),
      nativeFolder('folder-target', '1', 3, '目标文件夹'),
    ]),
  );
  return data.bookmarksBar.children;
}

describe('computeDropIndex', () => {
  it('同父级拖到目标之前', () => {
    expect(computeDropIndex(siblings(), 'c', 'a', 'before')).toBe(0);
    expect(computeDropIndex(siblings(), 'b', 'c', 'before')).toBe(1);
  });

  it('同父级拖到目标之后', () => {
    expect(computeDropIndex(siblings(), 'a', 'c', 'after')).toBe(2);
    expect(computeDropIndex(siblings(), 'c', 'a', 'after')).toBe(1);
  });

  it('移动到文件夹时追加到末尾', () => {
    expect(computeDropIndex(siblings(), 'b')).toBe(3);
  });

  it('跨文件夹时按目标文件夹当前子节点计算', () => {
    expect(computeDropIndex(siblings(), 'external', 'a', 'before')).toBe(0);
    expect(computeDropIndex(siblings(), 'external', 'b', 'after')).toBe(2);
  });

  it('目标不存在时返回 null', () => {
    expect(computeDropIndex(siblings(), 'a', 'missing', 'before')).toBeNull();
  });
});
