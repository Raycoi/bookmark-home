import { HEALTH_NEXT_CHECK_MS } from '../config/healthPolicy';
import type {
  WebsiteHealthCheckResult,
  WebsiteHealthRecord,
  WebsiteHealthStatus,
  WebsiteHealthStoredStatus,
} from '../types/websiteHealth';
import { t } from '../i18n';

const STORED_STATUSES: readonly WebsiteHealthStoredStatus[] = [
  'healthy',
  'redirected',
  'not_found',
  'gone',
  'restricted',
  'server_error',
  'unknown',
];

/** 状态到文案 key 的固定映射；状态枚举本身不随语言变化。 */
const STATUS_LABEL_KEYS: Record<WebsiteHealthStatus, string> = {
  healthy: 'health.status.healthy',
  redirected: 'health.status.redirected',
  not_found: 'health.status.not_found',
  gone: 'health.status.gone',
  restricted: 'health.status.restricted',
  server_error: 'health.status.server_error',
  unknown: 'health.status.unknown',
  pending: 'health.status.pending',
  checking: 'health.status.checking',
  unsupported: 'health.status.unsupported',
  private: 'health.status.private',
};

const STATUS_TONES: Record<
  WebsiteHealthStatus,
  'ok' | 'info' | 'warn' | 'error' | 'neutral'
> = {
  healthy: 'ok',
  redirected: 'info',
  not_found: 'error',
  gone: 'error',
  restricted: 'warn',
  server_error: 'error',
  unknown: 'warn',
  pending: 'neutral',
  checking: 'info',
  unsupported: 'neutral',
  private: 'neutral',
};

export function isStoredHealthStatus(value: unknown): value is WebsiteHealthStoredStatus {
  return (
    typeof value === 'string' &&
    (STORED_STATUSES as readonly string[]).includes(value)
  );
}

export function healthStatusLabel(status: WebsiteHealthStatus): string {
  return t(STATUS_LABEL_KEYS[status]);
}

export function healthStatusTone(
  status: WebsiteHealthStatus,
): 'ok' | 'info' | 'warn' | 'error' | 'neutral' {
  return STATUS_TONES[status];
}

/** 2xx/3xx/4xx/5xx 到明确业务状态的映射。 */
export function mapHttpStatus(
  httpStatus: number,
  redirected: boolean,
): WebsiteHealthStoredStatus {
  if (httpStatus >= 200 && httpStatus < 300) {
    return redirected ? 'redirected' : 'healthy';
  }
  if (httpStatus >= 300 && httpStatus < 400) {
    return 'redirected';
  }
  if (httpStatus === 404) {
    return 'not_found';
  }
  if (httpStatus === 410) {
    return 'gone';
  }
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 429 ||
    httpStatus === 451
  ) {
    return 'restricted';
  }
  if (httpStatus >= 500 && httpStatus < 600) {
    return 'server_error';
  }
  return 'unknown';
}

export function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

export function isAbnormalHealthStatus(status: WebsiteHealthStatus): boolean {
  return (
    status === 'not_found' ||
    status === 'gone' ||
    status === 'restricted' ||
    status === 'server_error'
  );
}

export function isHealthyHealthStatus(status: WebsiteHealthStatus): boolean {
  return status === 'healthy' || status === 'redirected';
}

export function getNextCheckAt(
  status: WebsiteHealthStoredStatus,
  now: number,
): number {
  return now + HEALTH_NEXT_CHECK_MS[status];
}

export function isHealthRecordStale(
  record: WebsiteHealthRecord,
  now: number,
): boolean {
  return record.nextCheckAt <= now;
}

/** 根据检测结果生成可持久化缓存记录。 */
export function createHealthRecord(
  url: string,
  result: WebsiteHealthCheckResult,
  now: number,
): WebsiteHealthRecord {
  const record: WebsiteHealthRecord = {
    url,
    status: result.status,
    checkedAt: now,
    nextCheckAt: getNextCheckAt(result.status, now),
    responseTime: result.responseTime,
    method: result.method,
  };

  if (result.httpStatus !== undefined) {
    record.httpStatus = result.httpStatus;
  }
  if (result.finalUrl !== undefined) {
    record.finalUrl = result.finalUrl;
  }
  if (result.errorMessage !== undefined) {
    record.errorMessage = result.errorMessage;
  }
  if (result.retryCount > 0) {
    record.retryCount = result.retryCount;
  }

  return record;
}

/** 用户能理解的中文失败说明；不暴露内部堆栈。 */
export function defaultHealthErrorMessage(
  status: WebsiteHealthStoredStatus,
  httpStatus?: number,
): string | undefined {
  switch (status) {
    case 'not_found':
      return t('health.error.http404');
    case 'gone':
      return t('health.error.http410');
    case 'restricted':
      return t('health.error.httpRestricted', { status: httpStatus ?? 401 });
    case 'server_error':
      return t('health.error.httpServerError', { status: httpStatus ?? 500 });
    case 'unknown':
      return httpStatus !== undefined
        ? t('health.error.httpUnknown', { status: httpStatus })
        : t('health.error.networkTemporary');
    default:
      return undefined;
  }
}
