import type { WebsiteHealthStoredStatus } from '../types/websiteHealth';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 各状态的下次检测间隔，集中管理，避免散落在检测/缓存/UI 中。 */
export const HEALTH_NEXT_CHECK_MS: Record<WebsiteHealthStoredStatus, number> = {
  healthy: 7 * DAY_MS,
  redirected: 7 * DAY_MS,
  not_found: DAY_MS,
  gone: 7 * DAY_MS,
  restricted: 3 * DAY_MS,
  server_error: 6 * 60 * 60 * 1000,
  unknown: 60 * 60 * 1000,
};

export const HEALTH_TIMEOUT_MS = 8_000;
export const HEALTH_INITIAL_TIMEOUT_MS = 3_000;
export const HEALTH_RETRY_DELAY_MS = 1_500;
export const HEALTH_MAX_RETRIES = 1;
export const HEALTH_GLOBAL_CONCURRENCY = 6;
export const HEALTH_PER_DOMAIN_CONCURRENCY = 2;
export const HEALTH_CACHE_RETENTION_MS = 30 * DAY_MS;
export const HEALTH_RECOVERY_LIMIT = 3;
export const HEALTH_NEW_BOOKMARK_DELAY_MS = 5_000;

export const HEALTH_SCHEMA_VERSION = 1 as const;
export const HEALTH_STATE_STORAGE_KEY = 'bookmarkHome.health.state';

export const HEALTH_ALARM_TICK = 'bookmarkHome.health.tick';
export const HEALTH_ALARM_MAINTENANCE = 'bookmarkHome.health.maintenance';
export const HEALTH_ALARM_CLEANUP = 'bookmarkHome.health.cleanup';

export const HEALTH_TICK_PERIOD_MINUTES = 1;
export const HEALTH_MAINTENANCE_PERIOD_MINUTES = 6 * 60;
export const HEALTH_CLEANUP_DELAY_MINUTES = 1;

export const HEALTH_TASK_PRIORITY = {
  manual: 0,
  bookmark_created: 1,
  scheduled: 2,
} as const;
