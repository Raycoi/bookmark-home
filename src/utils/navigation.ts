import { parseHttpUrl } from './httpUrl';

/**
 * 只允许把 http/https 地址用于主页导航与 favicon 请求。
 *
 * 书签原始 URL 不会被改写；此函数仅决定 UI 是否可以安全地渲染成链接。
 * 与健康检查缓存键不同，这里保留 fragment，用户点击后仍能定位到锚点。
 */
export function getNavigableUrl(input: string): string | null {
  const parsed = parseHttpUrl(input);
  return parsed.ok ? parsed.url.href : null;
}

/** 取得用于 favicon 查询的站点级 key，减少同一站点不同页面的重复请求。 */
export function getSiteKey(input: string): string | null {
  const parsed = parseHttpUrl(input);
  return parsed.ok ? `${parsed.url.origin}/` : null;
}
