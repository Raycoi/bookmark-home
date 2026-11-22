/**
 * HTTP(S) URL 的唯一解析/判定入口。
 *
 * 书签保存、主页导航、favicon、背景图片与健康检查都从这里判断
 * “这是不是可用的 http/https 地址”，避免各自复制 `new URL()`、
 * 协议白名单和主机名检查。
 *
 * 这里只做结构判断与安全拒绝；各调用方的规范化差异（补全协议、
 * 保留或移除 fragment、生成站点 key 等）仍由调用方决定。
 */

/** 解析失败的原因；调用方可据此给出具体提示。 */
export type HttpUrlFailure = 'empty' | 'malformed' | 'scheme' | 'missing-host';

export interface ParsedHttpUrl {
  /** 标准 URL 对象；字符串形式请读取 url.href。 */
  url: URL;
  /** 解析器规范化后的主机名：小写，IPv6 保留方括号。 */
  hostname: string;
}

export type HttpUrlParseResult =
  | ({ ok: true } & ParsedHttpUrl)
  | { ok: false; reason: HttpUrlFailure };

/**
 * 解析并校验 http/https URL。
 *
 * 只接受 http/https；javascript:、data:、file:、mailto:、ftp: 等一律拒绝。
 * 空输入、无法解析的地址、缺少主机名的地址分别返回不同的失败原因。
 */
export function parseHttpUrl(input: string): HttpUrlParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' };
  }

  if (!url.hostname) {
    return { ok: false, reason: 'missing-host' };
  }

  return { ok: true, url, hostname: url.hostname };
}

/** 布尔判定：输入是否为结构完整的 http/https 地址。 */
export function isHttpUrl(input: string): boolean {
  return parseHttpUrl(input).ok;
}
