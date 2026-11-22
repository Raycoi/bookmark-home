import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
} from '../src/types/appearance';

describe('外观设置规范化', () => {
  it('无效输入回退默认奶油色', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ backgroundKind: 'bad' })).toEqual(
      DEFAULT_APPEARANCE,
    );
  });

  it('限制遮罩范围并接受 http/https 图片', () => {
    const result = normalizeAppearance({
      backgroundKind: 'remote',
      remoteUrl: 'https://example.com/a.jpg',
      overlay: 99,
    });
    expect(result.backgroundKind).toBe('remote');
    expect(result.overlay).toBe(70);
  });

  it('拒绝非 HTTP 图片和非法 data URL', () => {
    const result = normalizeAppearance({
      backgroundKind: 'remote',
      remoteUrl: 'javascript:alert(1)',
      localDataUrl: 'data:text/html,<p>x</p>',
      overlay: -5,
    });
    expect(result.remoteUrl).toBe('');
    expect(result.localDataUrl).toBe('');
    expect(result.overlay).toBe(0);
  });

  it('接受大小写混合的 HTTP(S) 图片地址，拒绝其他协议', () => {
    expect(
      normalizeAppearance({
        backgroundKind: 'remote',
        remoteUrl: '  HTTPS://EXAMPLE.COM/a.png  ',
      }).remoteUrl,
    ).toBe('HTTPS://EXAMPLE.COM/a.png');

    for (const remoteUrl of [
      'file:///tmp/a.png',
      'mailto:dev@example.com',
      'javascript:alert(1)',
      'https://',
      '',
    ]) {
      expect(
        normalizeAppearance({ backgroundKind: 'remote', remoteUrl }).remoteUrl,
      ).toBe('');
    }
  });
});
