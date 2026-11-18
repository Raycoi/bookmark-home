/**
 * 只允许把 http/https 地址用于主页导航与 favicon 请求。
 *
 * 书签原始 URL 不会被改写；此函数仅决定 UI 是否可以安全地渲染成链接。
 */
export function getNavigableUrl(input: string): string | null {
  const value = input.trim();
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** 取得用于 favicon 查询的站点级 key，减少同一站点不同页面的重复请求。 */
export function getSiteKey(input: string): string | null {
  const safeUrl = getNavigableUrl(input);
  if (!safeUrl) {
    return null;
  }

  const url = new URL(safeUrl);
  return `${url.origin}/`;
}
