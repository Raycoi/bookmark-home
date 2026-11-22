import type { NativeBookmarkNode } from '../types/bookmark';
import { parseHttpUrl } from './httpUrl';

/**
 * 把书签 URL 规范化为健康检查缓存键。
 *
 * - 去除首尾空格；
 * - 只接受 http/https，其余协议与无效地址返回 null；
 * - 主机名、默认端口与路径点段由 URL 解析器统一规范化（主机名小写，
 *   https 的 :443、http 的 :80 会被省略）；
 * - 查询字符串随 href 一起重新序列化：参数顺序与重复键会保留，
 *   但百分号编码等细节以 URL 序列化结果为准，不保证与原始文本逐字节一致；
 * - 去除 fragment，使同一页面的不同锚点共用缓存键；
 * - 保留 HTTP/HTTPS 协议差异。
 */
export function normalizeHealthUrl(input: string | null | undefined): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const parsed = parseHttpUrl(input);
  if (!parsed.ok) {
    return null;
  }

  parsed.url.hash = '';
  return parsed.url.href;
}

/** 规范化 URL 的域名，用于同域并发限制。 */
export function getHealthDomain(normalizedUrl: string): string | null {
  const parsed = parseHttpUrl(normalizedUrl);
  return parsed.ok ? parsed.hostname : null;
}

const PRIVATE_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
] as const;

/**
 * 内网/本机地址保护。
 *
 * 不做 DNS 解析，只检查 URL 字面主机名；用于阻止把书签健康检查变成
 * 对内网服务、本机端口或云元数据地址的探测。公网域名若解析到内网 IP，
 * 仍需依赖浏览器/网络层的防护；这里不声称能阻止 DNS rebinding。
 *
 * 无法解析或不是 HTTP(S) 的输入一律按不安全处理（fail-closed），
 * 因为健康检查只面向公网 HTTP(S) 书签。
 */
export function isPrivateHealthUrl(normalizedUrl: string): boolean {
  const parsed = parseHttpUrl(normalizedUrl);
  if (!parsed.ok) {
    return true;
  }

  // URL 解析器已统一小写；IPv6 主机名保留方括号，这里去掉后再判断。
  const unwrapped = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const [host = ''] = unwrapped.split('%');
  if (!host) {
    return true;
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }

  if (host.includes(':')) {
    return isPrivateIpv6(host);
  }

  if (isPrivateIpv4(host)) {
    return true;
  }

  // 单标签主机名通常来自本地 hosts / 内网 DNS。
  return !host.includes('.');
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((part) => part > 255)) {
    return true;
  }

  const [a = 0, b = 0, c = 0] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 192 && b === 0 && (c === 0 || c === 2)) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  if (a === 198 && b === 51 && c === 100) {
    return true;
  }
  if (a === 203 && b === 0 && c === 113) {
    return true;
  }
  return false;
}

function isPrivateIpv6(host: string): boolean {
  if (host === '::' || host === '::1' || /^(0:){7}1$/.test(host)) {
    return true;
  }
  if (host.startsWith('::ffff:')) {
    return true;
  }
  if (/^fe[89ab][0-9a-f]*:/.test(host)) {
    return true;
  }
  if (/^f[cd][0-9a-f]*:/.test(host)) {
    return true;
  }
  if (host.startsWith('2001:db8:')) {
    return true;
  }
  return false;
}

/** 从原生书签树收集所有可检测的公网完整 URL，保持原生顺序并去重。 */
export function collectNativeBookmarkUrls(
  tree: readonly NativeBookmarkNode[],
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const visit = (nodes: readonly NativeBookmarkNode[]): void => {
    for (const node of nodes) {
      if (node.url) {
        const normalized = normalizeHealthUrl(node.url);
        if (normalized && !isPrivateHealthUrl(normalized) && !seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      }
      if (node.children && node.children.length > 0) {
        visit(node.children);
      }
    }
  };

  visit(tree);
  return urls;
}
