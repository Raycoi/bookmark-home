/** 网站健康检查的完整状态集合。 */
export type WebsiteHealthStatus =
  | 'healthy'
  | 'redirected'
  | 'not_found'
  | 'gone'
  | 'restricted'
  | 'server_error'
  | 'unknown'
  | 'pending'
  | 'checking'
  | 'unsupported'
  | 'private';

/** 会持久化到缓存的状态；pending/checking/unsupported 由运行时推导。 */
export type WebsiteHealthStoredStatus =
  | 'healthy'
  | 'redirected'
  | 'not_found'
  | 'gone'
  | 'restricted'
  | 'server_error'
  | 'unknown';

export type WebsiteHealthMethod = 'HEAD' | 'GET';

/** 单个规范化完整 URL 的检测缓存。 */
export interface WebsiteHealthRecord {
  url: string;
  status: WebsiteHealthStoredStatus;
  httpStatus?: number;
  finalUrl?: string;
  checkedAt: number;
  nextCheckAt: number;
  responseTime?: number;
  method: WebsiteHealthMethod;
  errorMessage?: string;
  retryCount?: number;
}

export type HealthTaskSource = 'manual' | 'scheduled' | 'bookmark_created';

export type HealthTaskStatus = 'pending' | 'checking';

/** 持久化到 storage.local 的待执行/执行中任务。 */
export interface HealthCheckTask {
  url: string;
  source: HealthTaskSource;
  priority: number;
  createdAt: number;
  notBefore: number;
  status: HealthTaskStatus;
  startedAt?: number;
  batchId?: string;
  recoveryCount: number;
  /** 1 = 快速初检；2 = 超时/网络/5xx 补充复查。 */
  attempt?: 1 | 2;
}

export type HealthScanMode = 'all' | 'abnormal';

export type HealthScanStatus = 'running' | 'completed' | 'cancelled';

/** 全量/异常扫描进度。 */
export interface HealthScanState {
  id: string;
  mode: HealthScanMode;
  status: HealthScanStatus;
  total: number;
  completed: number;
  startedAt: number;
  finishedAt?: number;
}

/** storage.local 中版本化的健康检查状态。 */
export interface HealthStorageState {
  schemaVersion: 1;
  records: Record<string, WebsiteHealthRecord>;
  tasks: HealthCheckTask[];
  scan: HealthScanState | null;
  ignoredUrls: string[];
  updatedAt: number;
}

/** 后台返回给新标签页的只读快照。 */
export interface HealthSnapshot {
  schemaVersion: 1;
  records: Record<string, WebsiteHealthRecord>;
  pendingUrls: string[];
  checkingUrls: string[];
  retryUrls: string[];
  ignoredUrls: string[];
  scan: HealthScanState | null;
  updatedAt: number;
}

/** 单次网络检测结果；不包含 pending/checking/unsupported。 */
export interface WebsiteHealthCheckResult {
  status: WebsiteHealthStoredStatus;
  httpStatus?: number;
  finalUrl?: string;
  responseTime: number;
  method: WebsiteHealthMethod;
  errorMessage?: string;
  retryCount: number;
}

export type HealthFilter =
  | 'all'
  | 'healthy'
  | 'abnormal'
  | 'pending'
  | 'unknown'
  | 'unsupported'
  | 'private'
  | 'unlisted';

export type HealthRequest =
  | { type: 'HEALTH_GET_SNAPSHOT' }
  | { type: 'HEALTH_CHECK_ALL' }
  | { type: 'HEALTH_CHECK_ABNORMAL' }
  | { type: 'HEALTH_RECHECK_URL'; url: string }
  | { type: 'HEALTH_IGNORE_URL'; url: string }
  | { type: 'HEALTH_UNIGNORE_URL'; url: string }
  | { type: 'HEALTH_CANCEL_SCAN' };

export interface HealthResponse {
  ok: boolean;
  snapshot?: HealthSnapshot;
  error?: string;
  notice?: string;
}

export interface StartScanResult {
  started: boolean;
  total: number;
  notice?: string;
}
