import { describe, expect, it } from 'vitest';
import {
  BookmarkValidationError,
  normalizeBookmarkTitle,
  normalizeBookmarkUrl,
  normalizeIndex,
} from '../src/utils/url';

describe('normalizeBookmarkUrl', () => {
  it('为省略协议的网址补全 https', () => {
    expect(normalizeBookmarkUrl('example.com')).toBe('https://example.com/');
    expect(normalizeBookmarkUrl('  example.com/path?q=1  ')).toBe(
      'https://example.com/path?q=1',
    );
  });

  it('统一协议与主机名大小写，保留路径大小写', () => {
    expect(normalizeBookmarkUrl('HTTPS://EXAMPLE.COM/Path')).toBe(
      'https://example.com/Path',
    );
    expect(normalizeBookmarkUrl('Example.COM')).toBe('https://example.com/');
  });

  it('把带端口但省略协议的网址当作主机名，而不是协议', () => {
    expect(normalizeBookmarkUrl('example.com:8080')).toBe(
      'https://example.com:8080/',
    );
    expect(normalizeBookmarkUrl('example.com:8080/path?q=1')).toBe(
      'https://example.com:8080/path?q=1',
    );
    expect(normalizeBookmarkUrl('localhost:3000')).toBe(
      'https://localhost:3000/',
    );
    expect(normalizeBookmarkUrl('127.0.0.1:8080')).toBe(
      'https://127.0.0.1:8080/',
    );
  });

  it('保留合法的 http/https 网址、尾斜杠、查询参数和 fragment', () => {
    expect(normalizeBookmarkUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(normalizeBookmarkUrl('https://example.com/a?q=1#top')).toBe(
      'https://example.com/a?q=1#top',
    );
    expect(normalizeBookmarkUrl('https://example.com')).toBe(
      'https://example.com/',
    );
  });

  it('拒绝空值、危险协议和无效格式', () => {
    expect(() => normalizeBookmarkUrl('')).toThrow(BookmarkValidationError);
    expect(() => normalizeBookmarkUrl('javascript:alert(1)')).toThrow('只支持 http 或 https');
    expect(() => normalizeBookmarkUrl('mailto:dev@example.com')).toThrow(
      '只支持 http 或 https',
    );
    expect(() => normalizeBookmarkUrl('file:///tmp/a.png')).toThrow(
      '只支持 http 或 https',
    );
    expect(() => normalizeBookmarkUrl('data:text/html,hello')).toThrow(
      '只支持 http 或 https',
    );
    expect(() => normalizeBookmarkUrl('ftp://example.com')).toThrow('只支持 http 或 https');
    expect(() => normalizeBookmarkUrl('https://')).toThrow('网址格式不正确');
    expect(() => normalizeBookmarkUrl('not a valid url')).toThrow(BookmarkValidationError);
  });
});

describe('normalizeBookmarkTitle', () => {
  it('去除首尾空白并拒绝空名称', () => {
    expect(normalizeBookmarkTitle('  我的书签  ')).toBe('我的书签');
    expect(() => normalizeBookmarkTitle('   ')).toThrow('名称不能为空');
    expect(() => normalizeBookmarkTitle('', '文件夹名称')).toThrow('文件夹名称不能为空');
  });
});

describe('normalizeIndex', () => {
  it('允许 0 和非负整数，拒绝非法位置', () => {
    expect(normalizeIndex(undefined)).toBeUndefined();
    expect(normalizeIndex(0)).toBe(0);
    expect(normalizeIndex(12)).toBe(12);
    expect(() => normalizeIndex(-1)).toThrow(BookmarkValidationError);
    expect(() => normalizeIndex(1.5)).toThrow(BookmarkValidationError);
  });
});
