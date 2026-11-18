import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFaviconUrlCache,
  getFaviconUrl,
} from '../src/utils/favicon';
import { getNavigableUrl, getSiteKey } from '../src/utils/navigation';

const getURL = vi.fn((path: string) => `chrome-extension://test${path}`);

beforeEach(() => {
  clearFaviconUrlCache();
  getURL.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('navigation', () => {
  it('只允许 http/https 链接，并规范化合法地址', () => {
    expect(getNavigableUrl(' https://example.com/a ')).toBe('https://example.com/a');
    expect(getNavigableUrl('http://example.com/')).toBe('http://example.com/');
    expect(getNavigableUrl('javascript:alert(1)')).toBeNull();
    expect(getNavigableUrl('data:text/html,hello')).toBeNull();
    expect(getNavigableUrl('ftp://example.com/')).toBeNull();
    expect(getNavigableUrl('not a url')).toBeNull();
    expect(getNavigableUrl('')).toBeNull();
  });

  it('按站点归并 favicon key，忽略路径和查询参数', () => {
    expect(getSiteKey('https://www.example.com/path?q=1#top')).toBe(
      'https://www.example.com/',
    );
    expect(getSiteKey('javascript:alert(1)')).toBeNull();
  });
});

describe('favicon', () => {
  it('使用 Chrome 本地 _favicon 接口，不访问第三方服务', () => {
    vi.stubGlobal('chrome', { runtime: { getURL } });

    const url = getFaviconUrl('https://github.com/explore?tab=repos');

    expect(url).toBe(
      'chrome-extension://test/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2F&size=64',
    );
    expect(getURL).toHaveBeenCalledTimes(1);
  });

  it('同一站点的不同页面复用同一个查询地址', () => {
    vi.stubGlobal('chrome', { runtime: { getURL } });

    const first = getFaviconUrl('https://example.com/a');
    const second = getFaviconUrl('https://example.com/b');
    const third = getFaviconUrl('https://example.com/a?q=2');

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(getURL).toHaveBeenCalledTimes(1);
  });

  it('非法 URL 不发起 favicon 查询', () => {
    vi.stubGlobal('chrome', { runtime: { getURL } });

    expect(getFaviconUrl('javascript:alert(1)')).toBeNull();
    expect(getFaviconUrl('')).toBeNull();
    expect(getURL).not.toHaveBeenCalled();
  });

  it('扩展 API 不可用时安全回退', () => {
    expect(getFaviconUrl('https://example.com/')).toBeNull();
  });

  it('缓存有上限，超出后淘汰最早条目', () => {
    vi.stubGlobal('chrome', { runtime: { getURL } });

    for (let index = 0; index < 301; index += 1) {
      getFaviconUrl(`https://site-${index}.example/`);
    }
    getURL.mockClear();
    getFaviconUrl('https://site-0.example/');

    expect(getURL).toHaveBeenCalledTimes(1);
  });
});
