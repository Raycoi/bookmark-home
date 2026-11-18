import { getSiteKey } from './navigation';

/**
 * 使用 Chrome 扩展自带的 _favicon 接口读取本地 favicon 缓存。
 *
 * 优点：
 * - 不把书签 URL 发送给第三方 favicon 服务；
 * - 同一站点只构造一个查询地址，并复用浏览器缓存；
 * - 主机权限是健康检查所需，_favicon 本身不依赖第三方服务。
 */
const faviconUrlCache = new Map<string, string>();
const MAX_FAVICON_CACHE_ENTRIES = 300;

export function getFaviconUrl(pageUrl: string, size = 64): string | null {
  const siteKey = getSiteKey(pageUrl);
  if (!siteKey) {
    return null;
  }

  const normalizedSize = Math.min(128, Math.max(16, Math.round(size)));
  const cacheKey = `${normalizedSize}:${siteKey}`;
  const cached = faviconUrlCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
    return null;
  }

  try {
    const faviconUrl = chrome.runtime.getURL(
      `/_favicon/?pageUrl=${encodeURIComponent(siteKey)}&size=${normalizedSize}`,
    );
    if (faviconUrlCache.size >= MAX_FAVICON_CACHE_ENTRIES) {
      const oldestKey = faviconUrlCache.keys().next().value;
      if (oldestKey !== undefined) {
        faviconUrlCache.delete(oldestKey);
      }
    }
    faviconUrlCache.set(cacheKey, faviconUrl);
    return faviconUrl;
  } catch {
    return null;
  }
}

/** 测试辅助：清空内存中的查询地址缓存。 */
export function clearFaviconUrlCache(): void {
  faviconUrlCache.clear();
}
