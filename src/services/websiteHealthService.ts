import {
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
import { normalizeHealthUrl, isPrivateHealthUrl } from '../utils/healthUrl';

export type HealthFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface WebsiteHealthCheckOptions {
  fetchImpl?: HealthFetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class UnsupportedHealthUrlError extends Error {
  constructor() {
    super('该地址不是可检测的 HTTP/HTTPS URL');
    this.name = 'UnsupportedHealthUrlError';
  }
}

export class PrivateHealthUrlError extends Error {
  constructor() {
    super('出于安全考虑，不检测内网/本机地址');
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
    throw new Error('当前环境不支持 fetch');
  }

  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? HEALTH_RETRY_DELAY_MS;
  const maxRetries = Math.max(0, options.maxRetries ?? HEALTH_MAX_RETRIES);
  const sleep = options.sleep ?? defaultSleep;
  let lastError: HealthRequestError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const outcome = await requestAttempt(url, fetchImpl, timeoutMs);

      if (isRetryableHttpStatus(outcome.httpStatus) && attempt < maxRetries) {
        lastError = new HealthRequestError(
          'network',
          outcome.method,
          outcome.responseTime,
          defaultHealthErrorMessage('server_error', outcome.httpStatus) ??
            '服务器异常',
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
              '网络连接异常，无法确认网站状态',
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
      ? `请求超时（${Math.round(timeoutMs / 1000)} 秒）`
      : '网络连接异常，无法确认网站状态';

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
        `请求超时（${Math.round(timeoutMs / 1000)} 秒）`,
      );
    }
    throw new HealthRequestError(
      'network',
      method,
      elapsed,
      '网络连接异常，无法确认网站状态',
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
