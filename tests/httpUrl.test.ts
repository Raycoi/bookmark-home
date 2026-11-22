import { describe, expect, it } from 'vitest';
import { isHttpUrl, parseHttpUrl } from '../src/utils/httpUrl';

function expectParsed(input: string) {
  const parsed = parseHttpUrl(input);
  if (!parsed.ok) {
    throw new Error(`预期 ${JSON.stringify(input)} 可解析，实际失败：${parsed.reason}`);
  }
  return parsed;
}

describe('parseHttpUrl', () => {
  it('统一小写主机名，保留路径大小写、端口与 fragment', () => {
    const parsed = expectParsed('  HTTPS://EXAMPLE.COM:8443/Path/?q=1#Frag  ');

    expect(parsed.url.href).toBe('https://example.com:8443/Path/?q=1#Frag');
    expect(parsed.hostname).toBe('example.com');
    expect(parsed.url.protocol).toBe('https:');
    expect(parsed.url.hash).toBe('#Frag');
  });

  it('省略默认端口，保留非默认端口与尾斜杠', () => {
    expect(expectParsed('https://example.com:443').url.href).toBe(
      'https://example.com/',
    );
    expect(expectParsed('http://example.com:80/a').url.href).toBe(
      'http://example.com/a',
    );
    expect(expectParsed('https://example.com:8443/').url.href).toBe(
      'https://example.com:8443/',
    );
    expect(expectParsed('https://example.com').url.href).toBe(
      'https://example.com/',
    );
  });

  it('区分空输入、格式错误与协议拒绝', () => {
    expect(parseHttpUrl('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseHttpUrl('not a url')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseHttpUrl('https://')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseHttpUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(parseHttpUrl('mailto:dev@example.com')).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(parseHttpUrl('file:///etc/hosts')).toEqual({ ok: false, reason: 'scheme' });
    expect(parseHttpUrl('data:text/html,hello')).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(parseHttpUrl('ftp://example.com/')).toEqual({
      ok: false,
      reason: 'scheme',
    });
  });
});

describe('isHttpUrl', () => {
  it('接受大小写混合的 http/https 地址', () => {
    expect(isHttpUrl('https://EXAMPLE.com/A?q=1#frag')).toBe(true);
    expect(isHttpUrl('HTTP://example.com:8080/')).toBe(true);
    expect(isHttpUrl('  https://example.com  ')).toBe(true);
  });

  it('拒绝空值、非法格式与非 HTTP(S) 协议', () => {
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl('   ')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('https://')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('mailto:dev@example.com')).toBe(false);
    expect(isHttpUrl('file:///tmp/a.png')).toBe(false);
    expect(isHttpUrl('data:text/html,hello')).toBe(false);
    expect(isHttpUrl('ftp://example.com/')).toBe(false);
  });

  it('与 parseHttpUrl 的 ok 结果保持一致', () => {
    const samples = [
      'https://example.com',
      'HTTPS://EXAMPLE.COM/path#frag',
      'http://127.0.0.1:8080/',
      'javascript:alert(1)',
      'mailto:dev@example.com',
      '',
    ];
    for (const sample of samples) {
      expect(isHttpUrl(sample)).toBe(parseHttpUrl(sample).ok);
    }
  });

  it('私有地址在结构上仍是合法 HTTP(S)，由健康检查策略单独拦截', () => {
    expect(isHttpUrl('http://127.0.0.1:8080/')).toBe(true);
    expect(isHttpUrl('http://[::1]/')).toBe(true);
    expect(isHttpUrl('http://intranet/')).toBe(true);
  });
});
