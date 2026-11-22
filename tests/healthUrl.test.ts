import { describe, expect, it } from 'vitest';
import {
  collectNativeBookmarkUrls,
  getHealthDomain,
  isPrivateHealthUrl,
  normalizeHealthUrl,
} from '../src/utils/healthUrl';
import {
  makeStandardTree,
  makeTree,
  nativeBookmark,
} from './fixtures/bookmarkTree';

describe('health URL 规范化', () => {
  it('统一主机名大小写、去掉 fragment 并保留路径', () => {
    expect(
      normalizeHealthUrl(
        '  https://EXAMPLE.com:443/Tutorial/Chapter-1?b=2&a=1#section  ',
      ),
    ).toBe('https://example.com/Tutorial/Chapter-1?b=2&a=1');
  });

  it('不排序或删除查询参数，但按 href 重新序列化', () => {
    expect(normalizeHealthUrl('https://example.com/search?z=9&a=1&utm=yes')).toBe(
      'https://example.com/search?z=9&a=1&utm=yes',
    );
    expect(normalizeHealthUrl('https://example.com/search?q=a b&b=2&a=1')).toBe(
      'https://example.com/search?q=a%20b&b=2&a=1',
    );
  });

  it('省略默认端口、保留非默认端口与尾斜杠', () => {
    expect(normalizeHealthUrl('HTTPS://EXAMPLE.COM')).toBe('https://example.com/');
    expect(normalizeHealthUrl('https://example.com:443/')).toBe(
      'https://example.com/',
    );
    expect(normalizeHealthUrl('https://example.com:8443/')).toBe(
      'https://example.com:8443/',
    );
  });

  it('保留 HTTP 与 HTTPS 差异', () => {
    expect(normalizeHealthUrl('http://example.com/page')).toBe(
      'http://example.com/page',
    );
    expect(normalizeHealthUrl('https://example.com/page')).toBe(
      'https://example.com/page',
    );
    expect(normalizeHealthUrl('http://example.com/page')).not.toBe(
      normalizeHealthUrl('https://example.com/page'),
    );
  });

  it('不同路径/查询得到不同缓存键，锚点不同得到相同键', () => {
    const base = normalizeHealthUrl('https://example.com/page');
    expect(normalizeHealthUrl('https://example.com/other')).not.toBe(base);
    expect(normalizeHealthUrl('https://example.com/page?x=1')).not.toBe(base);
    expect(normalizeHealthUrl('https://example.com/page#one')).toBe(base);
    expect(normalizeHealthUrl('https://example.com/page#two')).toBe(base);
  });

  it('拒绝无效和非 HTTP(S) 地址', () => {
    expect(normalizeHealthUrl('not a url')).toBeNull();
    expect(normalizeHealthUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeHealthUrl('mailto:dev@example.com')).toBeNull();
    expect(normalizeHealthUrl('data:text/html,hello')).toBeNull();
    expect(normalizeHealthUrl('file:///etc/hosts')).toBeNull();
    expect(normalizeHealthUrl('chrome://settings')).toBeNull();
    expect(normalizeHealthUrl('chrome-extension://abc/page.html')).toBeNull();
    expect(normalizeHealthUrl('')).toBeNull();
    expect(normalizeHealthUrl(null)).toBeNull();
  });

  it('提取同域限流使用的域名', () => {
    expect(getHealthDomain('https://EXAMPLE.com/path')).toBe('example.com');
    expect(getHealthDomain('not a url')).toBeNull();
  });
});

describe('内网/本机地址保护', () => {
  it.each([
    'http://localhost/',
    'http://LOCALHOST:8080/',
    'http://localhost./',
    'http://foo.localhost/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://10.0.0.1/',
    'http://100.100.100.200/',
    'http://169.254.169.254/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://192.0.2.1/',
    'http://198.18.0.1/',
    'http://203.0.113.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[FD00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://intranet/',
    'http://foo.local/',
    'http://foo.internal/',
    'http://foo.home.arpa/',
  ])('阻止 %s', (url) => {
    expect(isPrivateHealthUrl(normalizeHealthUrl(url) ?? url)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'https://EXAMPLE.COM/',
    'https://example.test/',
    'http://8.8.8.8/',
    'http://1.1.1.1/',
    'http://172.32.0.1/',
    'http://192.169.0.1/',
    'http://[2001:4860:4860::8888]/',
  ])('放行公网 %s', (url) => {
    expect(isPrivateHealthUrl(normalizeHealthUrl(url) ?? url)).toBe(false);
  });

  it('私有地址即使能被规范化，也不会被误判为可检测', () => {
    const normalized = normalizeHealthUrl('  HTTP://LOCALHOST:8080/#top  ');

    expect(normalized).toBe('http://localhost:8080/');
    expect(isPrivateHealthUrl(normalized ?? '')).toBe(true);
    expect(isPrivateHealthUrl('not a url')).toBe(true);
  });
});

describe('从原生书签树收集 URL', () => {
  it('保留原生顺序，按完整 URL 去重并覆盖其他书签/移动设备', () => {
    const urls = collectNativeBookmarkUrls(makeStandardTree());

    expect(urls[0]).toBe('https://www.google.com/');
    expect(urls).toContain('https://developer.chrome.com/docs/');
    expect(urls).toContain('https://example.org/mobile');
    expect(new Set(urls).size).toBe(urls.length);
    expect(
      urls.filter((url) => url === 'https://github.com/'),
    ).toHaveLength(1);
  });

  it('不把内网/本机地址加入后台检测列表', () => {
    const tree = makeTree([
      nativeBookmark('local', '1', 0, 'Local', 'http://127.0.0.1:43123/'),
      nativeBookmark('lan', '1', 1, 'LAN', 'http://192.168.1.2/'),
      nativeBookmark('public', '1', 2, 'Public', 'https://example.com/'),
      nativeBookmark('named', '1', 3, 'Named', 'http://intranet/'),
      nativeBookmark('v6', '1', 4, 'IPv6', 'http://[FD00::1]/'),
      nativeBookmark('upper', '1', 5, 'Uppercase', 'http://LOCALHOST:8080/'),
    ]);

    expect(collectNativeBookmarkUrls(tree)).toEqual(['https://example.com/']);
  });
});
