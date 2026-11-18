import { describe, expect, it } from 'vitest';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import { collectHomepageHealthEntries } from '../src/utils/healthBookmarks';
import {
  makeTree,
  nativeBookmark,
  nativeFolder,
} from './fixtures/bookmarkTree';

function makeData() {
  return transformBookmarkTree(
    makeTree(
      [
        nativeBookmark('bm-home', '1', 0, 'Home', 'https://example.com/#top'),
        nativeBookmark('bm-home-2', '1', 1, 'Home duplicate', 'https://example.com/'),
        nativeFolder('folder-dev', '1', 2, '开发', [
          nativeBookmark(
            'bm-page',
            'folder-dev',
            0,
            'Lesson',
            'https://EXAMPLE.com/lesson?b=2&a=1#part',
          ),
          nativeBookmark(
            'bm-unsupported',
            'folder-dev',
            1,
            '设置',
            'chrome://settings',
          ),
        ]),
        nativeFolder('folder-empty', '1', 3, '空'),
      ],
      [nativeBookmark('bm-other', '2', 0, 'Other', 'http://other.example/')],
      [nativeBookmark('bm-mobile', '3', 0, 'Mobile', 'https://mobile.example/')],
    ),
  );
}

describe('健康检查面板书签展开', () => {
  it('覆盖完整主页数据并按规范化 URL 去重', () => {
    const entries = collectHomepageHealthEntries(makeData());

    expect(entries).toHaveLength(5);
    const home = entries.find((entry) => entry.normalizedUrl === 'https://example.com/');
    expect(home?.bookmarkCount).toBe(2);
    expect(home?.title).toBe('Home');
    expect(entries.some((entry) => entry.normalizedUrl === 'http://other.example/')).toBe(
      true,
    );
    expect(
      entries.some((entry) => entry.normalizedUrl === 'https://mobile.example/'),
    ).toBe(true);
  });

  it('保留路径、查询参数和层级路径', () => {
    const entries = collectHomepageHealthEntries(makeData());
    const lesson = entries.find((entry) => entry.title === 'Lesson');

    expect(lesson?.normalizedUrl).toBe('https://example.com/lesson?b=2&a=1');
    expect(lesson?.folderPath).toBe('书签栏 / 开发');
  });

  it('非 HTTP(S) 地址保留为无法检测，不进入规范化 URL', () => {
    const entries = collectHomepageHealthEntries(makeData());
    const unsupported = entries.find((entry) => entry.title === '设置');

    expect(unsupported?.normalizedUrl).toBeNull();
    expect(unsupported?.rawUrl).toBe('chrome://settings');
    expect(unsupported?.key).toBe('unsupported:chrome://settings');
  });

  it('标记主页可见性和来源区域', () => {
    const entries = collectHomepageHealthEntries(makeData());
    const home = entries.find((entry) => entry.title === 'Home');
    const mobile = entries.find((entry) => entry.title === 'Mobile');

    expect(home?.isHomepageVisible).toBe(true);
    expect(home?.sectionTitle).toBe('书签栏');
    expect(mobile?.isHomepageVisible).toBe(false);
    expect(mobile?.sectionTitle).toBe('移动设备书签');
    expect(mobile?.parentId).toBe('3');
  });

  it('保留内网地址的规范化 URL 和父级用于定位', () => {
    const data = transformBookmarkTree(
      makeTree([
        nativeBookmark('local', '1', 0, 'Local', 'http://127.0.0.1:43123/'),
      ]),
    );
    const [entry] = collectHomepageHealthEntries(data);

    expect(entry?.parentId).toBe('1');
    expect(entry?.normalizedUrl).toBe('http://127.0.0.1:43123/');
  });

  it('额外区域书签标记为未展示', () => {
    const tree = makeTree([]);
    tree[0]?.children?.push(
      nativeFolder('extra-root', '0', 2, '额外区域', [
        nativeBookmark('extra-bookmark', 'extra-root', 0, 'Extra', 'https://extra.example/'),
      ]),
    );
    const entries = collectHomepageHealthEntries(transformBookmarkTree(tree));
    const extra = entries.find((entry) => entry.title === 'Extra');

    expect(extra?.isHomepageVisible).toBe(false);
    expect(extra?.sectionTitle).toBe('额外区域');
    expect(extra?.parentId).toBe('extra-root');
  });

  it('空数据返回空列表', () => {
    expect(collectHomepageHealthEntries(null)).toEqual([]);
  });
});
