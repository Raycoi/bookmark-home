import {
  HEALTH_INITIAL_TIMEOUT_MS,
  HEALTH_MAX_RETRIES,
  HEALTH_RETRY_DELAY_MS,
  HEALTH_TIMEOUT_MS,
} from '../config/healthPolicy';
import type {
  WebsiteHealthCheckResult,
  WebsiteHealthMethod,
} from '../types/websiteHealth';
import {
  defaultHealthErrorMessage,
  isRetryableHttpStatus,
  mapHttpStatus,
} from '../utils/healthStatus';
import {
  normalizeHealthUrl,
  isPrivateHealthUrl,
} from '../utils/healthUrl';
import { t } from '../i18n';

export type HealthFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface WebsiteHealthCheckOptions {
  fetchImpl?: HealthFetch;
  timeoutMs?: number;
  initialTimeoutMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class UnsupportedHealthUrlError extends Error {
  constructor() {
    super(t('health.error.unsupportedAddress'));
    this.name = 'UnsupportedHealthUrlError';
  }
}

export class PrivateHealthUrlError extends Error {
  constructor() {
    super(t('health.error.privateAddress'));
    this.name = 'PrivateHealthUrlError';
  }
}

type HealthRequestErrorKind = 'timeout' | 'network';

class HealthRequestError extends Error {
  readonly kind: HealthRequestErrorKind;
  readonly method: WebsiteHealthMethod;
  readonly responseTime: number;

  constructor(
    kind: HealthRequestErrorKind,
    method: WebsiteHealthMethod,
    responseTime: number,
    message: string,
  ) {
    super(message);
    this.name = 'HealthRequestError';
    this.kind = kind;
    this.method = method;
    this.responseTime = responseTime;
  }
}

interface RequestOutcome {
  httpStatus: number;
  contentType: string;
  contentLength: number | null;
  finalUrl?: string;
  redirected: boolean;
  responseTime: number;
  method: WebsiteHealthMethod;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 检测一个规范化完整 URL。
 *
 * 只在 Service Worker 中调用。优先 HEAD；服务器明确不支持 HEAD
 * （405/501）时用带 Range 的 GET 回退。网络/超时/5xx 最多重试一次。
 */
export async function checkWebsiteHealth(
  rawUrl: string,
  options: WebsiteHealthCheckOptions = {},
): Promise<WebsiteHealthCheckResult> {
  const url = normalizeHealthUrl(rawUrl);
  if (!url) {
    throw new UnsupportedHealthUrlError();
  }
  if (isPrivateHealthUrl(url)) {
    throw new PrivateHealthUrlError();
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(t('health.error.fetchUnavailable'));
  }

  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const initialTimeoutMs = Math.min(
    timeoutMs,
    options.initialTimeoutMs ?? HEALTH_INITIAL_TIMEOUT_MS,
  );
  const retryDelayMs = options.retryDelayMs ?? HEALTH_RETRY_DELAY_MS;
  const maxRetries = Math.max(0, options.maxRetries ?? HEALTH_MAX_RETRIES);  const sleep = options.sleep ?? defaultSleep;
  let lastError: HealthRequestError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const outcome = await requestAttempt(
        url,
        fetchImpl,
        attempt === 0 ? initialTimeoutMs : timeoutMs,
      );

      if (isRetryableHttpStatus(outcome.httpStatus) && attempt < maxRetries) {
        lastError = new HealthRequestError(
          'network',
          outcome.method,
          outcome.responseTime,
          defaultHealthErrorMessage('server_error', outcome.httpStatus) ??
            t('health.status.server_error'),
        );
        await sleep(retryDelayMs);
        continue;
      }

      const status = mapHttpStatus(outcome.httpStatus, outcome.redirected);
      const result: WebsiteHealthCheckResult = {
        status,
        httpStatus: outcome.httpStatus,
        responseTime: outcome.responseTime,
        method: outcome.method,
        retryCount: attempt,
      };

      if (outcome.finalUrl !== undefined) {
        result.finalUrl = outcome.finalUrl;
      }

      const audit = await auditHtmlPage(url, fetchImpl, outcome, timeoutMs);
      if (audit === 'soft404') {
        result.status = 'not_found';
        result.errorMessage = t('health.error.soft404');
        return result;
      }
      if (audit === 'login') {
        result.status = 'restricted';
        result.errorMessage = t('health.error.loginRequired');
        return result;
      }

      const errorMessage = defaultHealthErrorMessage(status, outcome.httpStatus);
      if (errorMessage !== undefined) {
        result.errorMessage = errorMessage;
      }

      return result;
    } catch (error) {
      const requestError =
        error instanceof HealthRequestError
          ? error
          : new HealthRequestError(
              'network',
              'HEAD',
              0,
              t('health.error.network'),
            );
      lastError = requestError;

      if (attempt < maxRetries) {
        await sleep(retryDelayMs);
        continue;
      }
    }
  }

  const responseTime = lastError?.responseTime ?? 0;
  const method = lastError?.method ?? 'HEAD';
  const message =
    lastError?.kind === 'timeout'
      ? lastError.message
      : t('health.error.network');

  return {
    status: 'unknown',
    responseTime,
    method,
    retryCount: maxRetries,
    errorMessage: message,
  };
}

async function requestAttempt(
  url: string,
  fetchImpl: HealthFetch,
  timeoutMs: number,
): Promise<RequestOutcome> {
  let method: WebsiteHealthMethod = 'HEAD';
  const head = await fetchWithTimeout(
    url,
    method,
    fetchImpl,
    timeoutMs,
    undefined,
  );
  let response = head.response;
  let responseTime = head.responseTime;

  if (response.status === 405 || response.status === 501) {
    await discardResponseBody(response);
    method = 'GET';
    const get = await fetchWithTimeout(url, method, fetchImpl, timeoutMs, {
      Range: 'bytes=0-0',
    });
    response = get.response;
    responseTime = get.responseTime;
  }

  const normalizedFinalUrl = normalizeHealthUrl(response.url);
  const finalUrl =
    normalizedFinalUrl && normalizedFinalUrl !== url
      ? normalizedFinalUrl
      : undefined;
  const redirected =
    response.redirected || (normalizedFinalUrl !== null && normalizedFinalUrl !== url);

  await discardResponseBody(response);

  const outcome: RequestOutcome = {
    httpStatus: response.status,
    contentType: response.headers.get('content-type')?.toLowerCase() ?? '',
    contentLength: parseContentLength(response.headers.get('content-length')),
    redirected,
    responseTime,
    method,
  };
  if (finalUrl !== undefined) {
    outcome.finalUrl = finalUrl;
  }
  return outcome;
}

async function fetchWithTimeout(
  url: string,
  method: WebsiteHealthMethod,
  fetchImpl: HealthFetch,
  timeoutMs: number,
  extraHeaders: Record<string, string> | undefined,
): Promise<{ response: Response; responseTime: number }> {
  const controller = new AbortController();
  let timedOut = false;
  const startedAt = nowMs();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const headers: Record<string, string> = {
    ...(extraHeaders ?? {}),
  };

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    return {
      response,
      responseTime: Math.max(0, Math.round(nowMs() - startedAt)),
    };
  } catch (error) {
    const elapsed = Math.max(0, Math.round(nowMs() - startedAt));
    if (timedOut || isAbortError(error)) {
      throw new HealthRequestError(
        'timeout',
        method,
        elapsed,
        t('health.error.timeout', { seconds: Math.round(timeoutMs / 1000) }),
      );
    }
    throw new HealthRequestError(
      'network',
      method,
      elapsed,
      t('health.error.network'),
    );
  } finally {
    clearTimeout(timer);
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 响应体可能已经被浏览器丢弃；读取状态只需响应头。
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const length = Number(value);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

function shouldAuditHtml(outcome: RequestOutcome): boolean {
  return (
    outcome.httpStatus >= 200 &&
    outcome.httpStatus < 300 &&
    outcome.contentType.includes('text/html') &&
    outcome.contentLength !== null &&
    outcome.contentLength > 0 &&
    outcome.contentLength <= 65_536
  );
}

async function auditHtmlPage(
  url: string,
  fetchImpl: HealthFetch,
  outcome: RequestOutcome,
  timeoutMs: number,
): Promise<'soft404' | 'login' | null> {
  if (!shouldAuditHtml(outcome)) return null;
  try {
    const response = await fetchWithTimeout(url, 'GET', fetchImpl, timeoutMs, {
      Range: 'bytes=0-65535',
    });
    const text = await readLimitedText(response.response, 65_536);
    await discardResponseBody(response.response);
    if (!text) return null;
    const head = text.slice(0, 16_384);
    const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const heading = head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
    const signal = `${title} ${heading}`;
    if (/(?:^|\D)404(?:\D|$)|not\s+found|page\s+not\s+found|页面不存在|找不到页面|页面未找到/i.test(signal)) {
      return 'soft404';
    }
    if (
      /<input[^>]+type\s*=\s*["']?password/i.test(head) ||
      /(?:sign\s*in|log\s*in|登录|登入)/i.test(signal) && /<form\b/i.test(head)
    ) {
      return 'login';
    }
    return null;
  } catch {
    return null;
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      const part = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(decoder.decode(part, { stream: true }));
      total += part.byteLength;
      if (part.byteLength < value.byteLength) break;
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.cancel().catch(() => {});
  }
}