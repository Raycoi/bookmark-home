import { t } from '../i18n';
import { parseHttpUrl, type HttpUrlFailure } from './httpUrl';

/** 用户输入校验错误，消息可以直接展示在界面上。 */
export class BookmarkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookmarkValidationError';
  }
}

/** 校验并规范化用户输入的书签名称。 */
export function normalizeBookmarkTitle(
  input: string,
  label = t('bookmark.label.name'),
): string {
  const title = input.trim();
  if (!title) {
    throw new BookmarkValidationError(t('validation.required', { label }));
  }
  return title;
}

/**
 * 用户可能输入的显式协议前缀。
 *
 * - `scheme://` 形式一律视为写了协议；
 * - 无 `//` 的已知非 HTTP 协议（mailto:、javascript:、data: 等）也必须原样保留；
 * - `example.com:8080` 不匹配这里，它会被当作“主机名 + 端口”补全 https，
 *   而不是误判成 `example.com:` 协议。
 */
const EXPLICIT_SCHEME =
  /^(?:[a-z][a-z\d+.-]*:\/\/|(?:mailto|javascript|data|file|ftp|chrome|chrome-extension|about|blob|view-source):)/i;

function bookmarkUrlErrorMessage(reason: HttpUrlFailure): string {
  switch (reason) {
    case 'scheme':
      return t('validation.urlScheme');
    case 'missing-host':
      return t('validation.urlMissingHost');
    default:
      return t('validation.urlInvalid');
  }
}

/**
 * 校验并规范化用户输入的新增书签网址。
 *
 * 只接受 http/https：避免把 javascript:、data: 等危险协议写入书签。
 * 用户省略协议时按 https 补全；协议差异、路径和 fragment 由 href 原样保留。
 */
export function normalizeBookmarkUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new BookmarkValidationError(
      t('validation.required', { label: t('bookmark.label.url') }),
    );
  }

  const candidate = EXPLICIT_SCHEME.test(raw) ? raw : `https://${raw}`;

  const parsed = parseHttpUrl(candidate);
  if (!parsed.ok) {
    throw new BookmarkValidationError(bookmarkUrlErrorMessage(parsed.reason));
  }

  return parsed.url.href;
}

/** 校验 Chrome 书签节点 ID。 */
export function normalizeNodeId(
  input: string,
  label = t('bookmark.label.nodeId'),
): string {
  const id = input.trim();
  if (!id) {
    throw new BookmarkValidationError(t('validation.required', { label }));
  }
  return id;
}

/** 校验可选的排序位置。 */
export function normalizeIndex(input: number | undefined): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Number.isInteger(input) || input < 0) {
    throw new BookmarkValidationError(t('validation.indexInvalid'));
  }

  return input;
}
