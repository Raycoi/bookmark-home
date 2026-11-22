import {
  HEALTH_GLOBAL_CONCURRENCY,
  HEALTH_PER_DOMAIN_CONCURRENCY,
  HEALTH_RETRY_DELAY_MS,
  HEALTH_NEW_BOOKMARK_DELAY_MS,
  HEALTH_RECOVERY_LIMIT,
} from '../config/healthPolicy';
import type {
  HealthCheckTask,
  HealthScanMode,
  HealthSnapshot,
  HealthTaskSource,
  StartScanResult,
  WebsiteHealthCheckResult,
} from '../types/websiteHealth';
import {
  findHealthTask,
  getExpiredHealthRecords,
  pruneHealthState,
  reconcileScanState,
  saveHealthRecord,
  upsertHealthTask,
  type HealthCacheService,
} from './healthCacheService';
import { createHealthRecord, isAbnormalHealthStatus } from '../utils/healthStatus';
import { getHealthDomain, isPrivateHealthUrl, normalizeHealthUrl } from '../utils/healthUrl';
import { getErrorMessage } from '../utils/errors';
import { t } from '../i18n';

export interface HealthCheckSchedulerDeps {
  cache: HealthCacheService;
  checkUrl: (url: string, attempt: 1 | 2) => Promise<WebsiteHealthCheckResult>;
  getReferencedUrls: () => Promise<string[]>;
  now?: () => number;
  globalConcurrency?: number;
  perDomainConcurrency?: number;
}

export interface HealthCheckScheduler {
  initialize(): Promise<void>;
  requestPass(): Promise<void>;
  startScan(mode: HealthScanMode): Promise<StartScanResult>;
  cancelScan(): Promise<HealthSnapshot>;
  recheck(rawUrl: string): Promise<boolean>;
  ignoreUrl(rawUrl: string): Promise<boolean>;
  unignoreUrl(rawUrl: string): Promise<boolean>;
  queueBookmarkUrl(rawUrl: string, source?: HealthTaskSource): Promise<void>;
  queueBookmarkUrls(
    rawUrls: readonly string[],
    source?: HealthTaskSource,
  ): Promise<void>;
  cleanupOrphans(): Promise<void>;
  refreshExpiredTasks(): Promise<void>;
  getSnapshot(): Promise<HealthSnapshot>;
}

/**
 * 持久化健康检查队列。
 *
 * 不直接访问 chrome.storage/bookmarks/fetch，依赖由后台入口注入，
 * 因此并发、优先级、恢复和扫描逻辑可以在 Node 中测试。
 */
export function createHealthCheckScheduler(
  deps: HealthCheckSchedulerDeps,
): HealthCheckScheduler {
  const cache = deps.cache;
  const checkUrl = deps.checkUrl;
  const getReferencedUrls = deps.getReferencedUrls;
  const now = deps.now ?? Date.now;
  const globalConcurrency = Math.max(
    1,
    deps.globalConcurrency ?? HEALTH_GLOBAL_CONCURRENCY,
  );
  const perDomainConcurrency = Math.max(
    1,
    deps.perDomainConcurrency ?? HEALTH_PER_DOMAIN_CONCURRENCY,
  );

  let initializePromise: Promise<void> | null = null;
  let passPromise: Promise<void> | null = null;
  let passRequested = false;
  let scanStartPromise: Promise<StartScanResult> | null = null;
  let nextPassTimer: ReturnType<typeof setTimeout> | null = null;

  function initialize(): Promise<void> {
    if (!initializePromise) {
      initializePromise = recoverInterruptedTasks().catch((error) => {
        // 允许后续事件重新尝试恢复，避免一次存储失败永久阻断调度器。
        initializePromise = null;
        throw error;
      });
    }
    return initializePromise;
  }

  async function recoverInterruptedTasks(): Promise<void> {
    await cache.update((state) => {
      for (const task of state.tasks) {
        if (task.status !== 'checking') {
          continue;
        }

        if (task.recoveryCount >= HEALTH_RECOVERY_LIMIT) {
          const record = createHealthRecord(
            task.url,
            {
              status: 'unknown',
              responseTime: 0,
              method: 'HEAD',
              retryCount: 0,
              errorMessage: t('health.error.interrupted'),
            },
            now(),
          );
          saveHealthRecord(state, record);
          state.tasks = state.tasks.filter((item) => item.url !== task.url);
          bumpScanProgress(state, task);
          continue;
        }

        task.status = 'pending';
        task.recoveryCount += 1;
        delete task.startedAt;
      }

      reconcileScanState(state, now());
    });
  }

  async function queueBookmarkUrl(
    rawUrl: string,
    source: HealthTaskSource = 'bookmark_created',
  ): Promise<void> {
    await initialize();
    const url = normalizeHealthUrl(rawUrl);
    if (!url || isPrivateHealthUrl(url)) {
      return;
    }

    const queuedAt = now();
    await cache.update((state) => {
      if (state.ignoredUrls.includes(url)) {
        return;
      }
      upsertHealthTask(state, url, source, queuedAt, {
        notBefore:
          source === 'bookmark_created'
            ? queuedAt + HEALTH_NEW_BOOKMARK_DELAY_MS
            : queuedAt,
      });
    });
  }

  async function queueBookmarkUrls(
    rawUrls: readonly string[],
    source: HealthTaskSource = 'bookmark_created',
  ): Promise<void> {
    await initialize();
    const urls = sanitizeReferencedUrls(rawUrls);
    if (urls.length === 0) {
      return;
    }

    const queuedAt = now();
    const state = await cache.read();
    const candidates = urls.filter((url) => {
      if (state.ignoredUrls.includes(url)) {
        return false;
      }
      const record = state.records[url];
      return !record || record.nextCheckAt <= queuedAt;
    });
    if (candidates.length === 0) {
      return;
    }

    await cache.update((nextState) => {
      for (const url of candidates) {
        upsertHealthTask(nextState, url, source, queuedAt, {
          notBefore:
            source === 'bookmark_created'
              ? queuedAt + HEALTH_NEW_BOOKMARK_DELAY_MS
              : queuedAt,
        });
      }
    });
  }

  async function recheck(rawUrl: string): Promise<boolean> {
    await initialize();
    const url = normalizeHealthUrl(rawUrl);
    if (!url || isPrivateHealthUrl(url)) {
      return false;
    }

    const checkedAt = now();
    await cache.update((state) => {
      const task = upsertHealthTask(state, url, 'manual', checkedAt, {
        notBefore: checkedAt,
      });
      if (task.status !== 'checking') {
        task.status = 'pending';
        task.attempt = 1;
        task.notBefore = checkedAt;
        task.recoveryCount = 0;
        delete task.startedAt;
      }
    });
    void requestPass();
    return true;
  }

  async function ignoreUrl(rawUrl: string): Promise<boolean> {
    await initialize();
    const url = normalizeHealthUrl(rawUrl);
    if (!url || isPrivateHealthUrl(url)) {
      return false;
    }

    let ignored = false;
    await cache.update((state) => {
      if (state.scan?.status === 'running') {
        return;
      }
      if (!state.ignoredUrls.includes(url)) {
        state.ignoredUrls.push(url);
      }
      state.tasks = state.tasks.filter((task) => task.url !== url);
      ignored = true;
    });
    return ignored;
  }

  async function unignoreUrl(rawUrl: string): Promise<boolean> {
    await initialize();
    const url = normalizeHealthUrl(rawUrl);
    if (!url) {
      return false;
    }

    let restored = false;
    await cache.update((state) => {
      const next = state.ignoredUrls.filter((item) => item !== url);
      if (next.length !== state.ignoredUrls.length) {
        state.ignoredUrls = next;
        restored = true;
      }
    });
    return restored;
  }

  function requestPass(): Promise<void> {
    if (nextPassTimer) {
      clearTimeout(nextPassTimer);
      nextPassTimer = null;
    }

    if (passPromise) {
      passRequested = true;
      return passPromise;
    }

    passPromise = runPass()
      .catch((error) => {
        console.warn('[Bookmark Home] 健康检查调度失败', getErrorMessage(error));
      })
      .finally(() => {
        passPromise = null;
        if (passRequested) {
          passRequested = false;
          void requestPass();
        }
      });
    return passPromise;
  }

  async function runPass(): Promise<void> {
    await initialize();
    await refreshExpiredTasks();

    const state = await cache.read();
    const tasks = interleaveByPriorityAndHost(
      state.tasks.filter(
        (task) =>
          task.status === 'pending' &&
          task.notBefore <= now() &&
          !isPrivateHealthUrl(task.url),
      ),
    );

    if (tasks.length > 0) {
      await runTaskPool(tasks);
    }

    await scheduleContinuationIfNeeded();
  }

  /**
   * 动态 worker 池：每个 worker 完成一个任务后立刻从队列领取下一个，
   * 不等待其他 worker，也不按批次等待。同域计数只限制本域，不占全局槽位。
   */
  async function runTaskPool(tasks: HealthCheckTask[]): Promise<void> {
    const queue = [...tasks];
    const activeHosts = new Map<string, number>();
    let active = 0;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (!settled && active === 0 && queue.length === 0) {
          settled = true;
          resolve();
        }
      };

      const pump = (): void => {
        if (settled) {
          return;
        }

        while (active < globalConcurrency) {
          const index = queue.findIndex((task) => {
            const host = getHealthDomain(task.url) ?? task.url;
            return (activeHosts.get(host) ?? 0) < perDomainConcurrency;
          });
          if (index < 0) {
            break;
          }

          const task = queue[index];
          if (!task) {
            break;
          }
          queue.splice(index, 1);
          const host = getHealthDomain(task.url) ?? task.url;
          active += 1;
          activeHosts.set(host, (activeHosts.get(host) ?? 0) + 1);

          void claimTask(task.url)
            .then((claimed) => (claimed ? executeTask(task) : undefined))
            .catch((error) => {
              console.warn(
                '[Bookmark Home] 健康检查任务执行失败',
                getErrorMessage(error),
              );
            })
            .finally(() => {
              active -= 1;
              const remaining = (activeHosts.get(host) ?? 1) - 1;
              if (remaining <= 0) {
                activeHosts.delete(host);
              } else {
                activeHosts.set(host, remaining);
              }
              pump();
              finish();
            });
        }

        finish();
      };

      pump();
    });
  }

  async function claimTask(url: string): Promise<boolean> {
    let claimed = false;
    const claimedAt = now();

    await cache.update((state) => {
      const task = state.tasks.find((item) => item.url === url);
      if (!task || task.status !== 'pending' || task.notBefore > claimedAt) {
        return;
      }
      task.status = 'checking';
      task.startedAt = claimedAt;
      task.attempt = task.attempt === 2 ? 2 : 1;
      claimed = true;
    });

    return claimed;
  }

  async function scheduleContinuationIfNeeded(): Promise<void> {
    if (passRequested || nextPassTimer) {
      return;
    }

    const state = await cache.read();
    const pending = state.tasks.filter(
      (task) =>
        task.status === 'pending' &&
        !isPrivateHealthUrl(task.url),
    );

    if (pending.length === 0) {
      return;
    }

    if (pending.some((task) => task.notBefore <= now())) {
      passRequested = true;
      return;
    }

    const nextAt = Math.min(...pending.map((task) => task.notBefore));
    nextPassTimer = setTimeout(() => {
      nextPassTimer = null;
      void requestPass();
    }, Math.max(0, nextAt - now()));
  }

  async function executeTask(task: HealthCheckTask): Promise<void> {
    const attempt: 1 | 2 = task.attempt === 2 ? 2 : 1;
    let result: WebsiteHealthCheckResult;

    try {
      result = await checkUrl(task.url, attempt);
    } catch (error) {
      result = {
        status: 'unknown',
        responseTime: 0,
        method: 'HEAD',
        retryCount: 0,
        errorMessage: t('health.error.unknownWithDetail', {
          message: getErrorMessage(error),
        }),
      };
    }

    await cache.update((state) => {
      const existing = findHealthTask(state, task.url);
      if (!existing) {
        return;
      }

      const record = createHealthRecord(task.url, result, now());
      saveHealthRecord(state, record);

      if (attempt === 1 && isRetryableHealthResult(result)) {
        existing.status = 'pending';
        existing.attempt = 2;
        existing.notBefore = now() + HEALTH_RETRY_DELAY_MS;
        existing.recoveryCount = 0;
        delete existing.startedAt;
        return;
      }

      state.tasks = state.tasks.filter((item) => item.url !== task.url);

      if (state.scan?.status === 'running' && existing.batchId === state.scan.id) {
        state.scan.completed = Math.min(
          state.scan.total,
          state.scan.completed + 1,
        );
      }

      reconcileScanState(state, now());
    });
  }

  async function refreshExpiredTasks(): Promise<void> {
    const state = await cache.read();
    const expired = getExpiredHealthRecords(state, now());
    if (expired.length === 0) {
      return;
    }

    const referenced = new Set(sanitizeReferencedUrls(await getReferencedUrls()));

    await cache.update((nextState) => {
      for (const record of expired) {
        if (!referenced.has(record.url)) {
          continue;
        }
        if (nextState.ignoredUrls.includes(record.url)) {
          continue;
        }
        if (findHealthTask(nextState, record.url)) {
          continue;
        }
        upsertHealthTask(nextState, record.url, 'scheduled', now());
      }
    });
  }

  async function startScan(mode: HealthScanMode): Promise<StartScanResult> {
    if (scanStartPromise) {
      return scanStartPromise;
    }

    scanStartPromise = startScanInternal(mode).finally(() => {
      scanStartPromise = null;
    });
    return scanStartPromise;
  }

  async function startScanInternal(mode: HealthScanMode): Promise<StartScanResult> {
    await initialize();
    const snapshot = await cache.read();

    if (snapshot.scan?.status === 'running') {
      return {
        started: false,
        total: snapshot.scan.total,
        notice: t('health.notice.scanRunning'),
      };
    }

    const referenced = sanitizeReferencedUrls(await getReferencedUrls());
    const ignored = new Set(snapshot.ignoredUrls);
    const activeReferenced = referenced.filter((url) => !ignored.has(url));
    const urls =
      mode === 'abnormal'
        ? activeReferenced.filter((url) => {
            const record = snapshot.records[url];
            return record ? isAbnormalHealthStatus(record.status) : false;
          })
        : activeReferenced;

    if (urls.length === 0) {
      return {
        started: false,
        total: 0,
        notice:
          mode === 'abnormal'
            ? t('health.notice.noAbnormalUrls')
            : t('health.notice.noCheckableUrls'),
      };
    }

    const startedAt = now();
    const scanId = `health-scan-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
    let started = false;

    await cache.update((state) => {
      if (state.scan?.status === 'running') {
        return;
      }

      for (const task of state.tasks) {
        if (task.batchId !== undefined) {
          delete task.batchId;
        }
      }

      state.scan = {
        id: scanId,
        mode,
        status: 'running',
        total: urls.length,
        completed: 0,
        startedAt,
      };

      for (const url of urls) {
        const task = upsertHealthTask(state, url, 'manual', startedAt, {
          notBefore: startedAt,
          batchId: scanId,
        });
        if (task.status !== 'checking') {
          task.status = 'pending';
          task.attempt = 1;
          task.notBefore = startedAt;
          task.recoveryCount = 0;
          delete task.startedAt;
        }
      }

      started = true;
    });

    if (!started) {
      const latest = await cache.getSnapshot();
      return {
        started: false,
        total: latest.scan?.total ?? 0,
        notice: t('health.notice.scanRunning'),
      };
    }

    void requestPass();
    return { started: true, total: urls.length };
  }

  async function cancelScan(): Promise<HealthSnapshot> {
    await initialize();
    const cancelledAt = now();

    await cache.update((state) => {
      const scan = state.scan;
      if (!scan || scan.status !== 'running') {
        return;
      }

      scan.status = 'cancelled';
      scan.finishedAt = cancelledAt;
      state.tasks = state.tasks.filter(
        (task) => !(task.batchId === scan.id && task.status === 'pending'),
      );

      // 已发出的请求允许完成，但不再计入已取消的扫描。
      for (const task of state.tasks) {
        if (task.batchId === scan.id) {
          delete task.batchId;
        }
      }
    });

    return cache.getSnapshot();
  }

  async function cleanupOrphans(): Promise<void> {
    await initialize();
    const referenced = new Set(sanitizeReferencedUrls(await getReferencedUrls()));

    await cache.update((state) => {
      pruneHealthState(state, referenced, now());
    });
  }

  return {
    initialize,
    requestPass,
    startScan,
    cancelScan,
    recheck,
    ignoreUrl,
    unignoreUrl,
    queueBookmarkUrl,
    queueBookmarkUrls,
    cleanupOrphans,
    refreshExpiredTasks,
    getSnapshot: () => cache.getSnapshot(),
  };
}

/** 内网/非 HTTP 地址不进入队列，作为后台侧的第二道保护。 */
function sanitizeReferencedUrls(urls: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawUrl of urls) {
    const url = normalizeHealthUrl(rawUrl);
    if (!url || isPrivateHealthUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push(url);
  }

  return result;
}

/** 只有无法确认的状态进入第二阶段；4xx/403/429 不复查。 */
function isRetryableHealthResult(result: WebsiteHealthCheckResult): boolean {
  return result.status === 'unknown' || result.status === 'server_error';
}

/**
 * 先按优先级分组，再在组内按 hostname 交错，避免同域任务扎堆，
 * 同时不破坏 manual 高于 scheduled/bookmark_created 的调度语义。
 */
function interleaveByPriorityAndHost(
  tasks: readonly HealthCheckTask[],
): HealthCheckTask[] {
  const byPriority = new Map<number, HealthCheckTask[]>();
  for (const task of tasks) {
    const group = byPriority.get(task.priority);
    if (group) {
      group.push(task);
    } else {
      byPriority.set(task.priority, [task]);
    }
  }

  const result: HealthCheckTask[] = [];
  for (const priority of [...byPriority.keys()].sort((a, b) => a - b)) {
    const group = byPriority.get(priority) ?? [];
    const buckets = new Map<string, HealthCheckTask[]>();
    for (const task of group) {
      const host = getHealthDomain(task.url) ?? task.url;
      const bucket = buckets.get(host);
      if (bucket) {
        bucket.push(task);
      } else {
        buckets.set(host, [task]);
      }
    }

    const queues = [...buckets.values()].sort((a, b) => b.length - a.length);
    const maxLength = queues[0]?.length ?? 0;
    for (let round = 0; round < maxLength; round += 1) {
      for (const queue of queues) {
        const task = queue[round];
        if (task) {
          result.push(task);
        }
      }
    }
  }

  return result;
}


function bumpScanProgress(
  state: {
    scan: import('../types/websiteHealth').HealthScanState | null;
  },
  task: HealthCheckTask,
): void {
  if (
    state.scan?.status === 'running' &&
    task.batchId === state.scan.id
  ) {
    state.scan.completed = Math.min(state.scan.total, state.scan.completed + 1);
  }
}
