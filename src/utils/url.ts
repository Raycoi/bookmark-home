/** 用户输入校验错误，消息可以直接展示在界面上。 */
export class BookmarkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookmarkValidationError';
  }
}

/** 校验并规范化用户输入的书签名称。 */
export function normalizeBookmarkTitle(input: string, label = '名称'): string {
  const title = input.trim();
  if (!title) {
    throw new BookmarkValidationError(`${label}不能为空`);
  }
  return title;
}

/**
 * 校验并规范化用户输入的新增书签网址。
 *
 * 只接受 http/https：避免把 javascript:、data: 等危险协议写入书签。
 * 用户省略协议时按 https 补全。
 */
export function normalizeBookmarkUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new BookmarkValidationError('网址不能为空');
  }

  const explicitScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw);
  // 无 // 的非 HTTP 协议（mailto:、javascript:、data: 等）也必须先识别，
  // 但不能把 example.com:8080 误判成 example.com: 协议。
  const nonHttpScheme =
    /^(?:mailto|javascript|data|file|ftp|chrome|chrome-extension|about|blob|view-source):/i.test(
      raw,
    );
  const candidate = explicitScheme || nonHttpScheme ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BookmarkValidationError('网址格式不正确');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BookmarkValidationError('只支持 http 或 https 网址');
  }

  if (!parsed.hostname) {
    throw new BookmarkValidationError('网址缺少有效域名');
  }

  return parsed.toString();
}

/** 校验 Chrome 书签节点 ID。 */
export function normalizeNodeId(input: string, label = '书签节点 ID'): string {
  const id = input.trim();
  if (!id) {
    throw new BookmarkValidationError(`${label}不能为空`);
  }
  return id;
}

/** 校验可选的排序位置。 */
export function normalizeIndex(input: number | undefined): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Number.isInteger(input) || input < 0) {
    throw new BookmarkValidationError('排序位置必须是非负整数');
  }

  return input;
}
