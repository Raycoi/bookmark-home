import { HEALTH_NEXT_CHECK_MS } from '../config/healthPolicy';
import type {
  WebsiteHealthCheckResult,
  WebsiteHealthRecord,
  WebsiteHealthStatus,
  WebsiteHealthStoredStatus,
} from '../types/websiteHealth';

const STORED_STATUSES: readonly WebsiteHealthStoredStatus[] = [
  'healthy',
  'redirected',
  'not_found',
  'gone',
  'restricted',
  'server_error',
  'unknown',
];

const STATUS_LABELS: Record<WebsiteHealthStatus, string> = {
  healthy: '正常',
  redirected: '已跳转',
  not_found: '页面不存在',
  gone: '页面已移除',
  restricted: '访问受限',
  server_error: '服务器异常',
  unknown: '无法确认',
  pending: '待检测',
  checking: '检测中',
  unsupported: '无法检测',
  private: '内网地址',
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
  return STATUS_LABELS[status];
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
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
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
      return '页面不存在（HTTP 404）';
    case 'gone':
      return '页面已移除（HTTP 410）';
    case 'restricted':
      return `访问受限（HTTP ${httpStatus ?? 401}）`;
    case 'server_error':
      return `服务器返回异常（HTTP ${httpStatus ?? 500}）`;
    case 'unknown':
      return httpStatus !== undefined
        ? `无法确认网站状态（HTTP ${httpStatus}）`
        : '网络连接异常，暂时无法确认网站状态';
    default:
      return undefined;
  }
}
