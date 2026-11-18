import {
  HEALTH_GLOBAL_CONCURRENCY,
  HEALTH_MAX_TASKS_PER_PASS,
  HEALTH_CONTINUATION_DELAY_MS,
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

export interface HealthCheckSchedulerDeps {
  cache: HealthCacheService;
  checkUrl: (url: string) => Promise<WebsiteHealthCheckResult>;
  getReferencedUrls: () => Promise<string[]>;
  now?: () => number;
  maxTasksPerPass?: number;
  globalConcurrency?: number;
  continuationDelayMs?: number;
}

export interface HealthCheckScheduler {
  initialize(): Promise<void>;
  requestPass(): Promise<void>;
  startScan(mode: HealthScanMode): Promise<StartScanResult>;
  cancelScan(): Promise<HealthSnapshot>;
  recheck(rawUrl: string): Promise<boolean>;
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
  const maxTasksPerPass = Math.max(1, deps.maxTasksPerPass ?? HEALTH_MAX_TASKS_PER_PASS);
  const globalConcurrency = Math.max(
    1,
    deps.globalConcurrency ?? HEALTH_GLOBAL_CONCURRENCY,
  );
  const continuationDelayMs = Math.max(
    0,
    deps.continuationDelayMs ?? HEALTH_CONTINUATION_DELAY_MS,
  );

  let initializePromise: Promise<void> | null = null;
  let passPromise: Promise<void> | null = null;
  let passRequested = false;
  let scanStartPromise: Promise<StartScanResult> | null = null;
  let continuationTimer: ReturnType<typeof setTimeout> | null = null;

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
              errorMessage: '检测多次中断，暂时无法确认网站状态',
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
      upsertHealthTask(state, url, 'manual', checkedAt, {
        notBefore: checkedAt,
      });
    });
    void requestPass();
    return true;
  }

  function requestPass(): Promise<void> {
    if (continuationTimer) {
      clearTimeout(continuationTimer);
      continuationTimer = null;
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

    const running = new Map<string, Promise<void>>();
    const activeDomains = new Set<string>();
    let started = 0;

    while (started < maxTasksPerPass) {
      if (running.size >= globalConcurrency) {
        await Promise.race(running.values());
        continue;
      }

      const task = await claimNextTask(
        activeDomains,
        new Set(running.keys()),
        now(),
      );

      if (!task) {
        if (running.size === 0) {
          break;
        }
        await Promise.race(running.values());
        continue;
      }

      const domain = getHealthDomain(task.url) ?? task.url;
      started += 1;
      activeDomains.add(domain);

      const operation = executeTask(task).finally(() => {
        running.delete(task.url);
        activeDomains.delete(domain);
      });
      running.set(task.url, operation);
    }

    await Promise.all(running.values());
    await scheduleContinuationIfNeeded();
  }

  async function scheduleContinuationIfNeeded(): Promise<void> {
    if (passRequested || continuationTimer) {
      return;
    }

    const state = await cache.read();
    if (
      !state.tasks.some(
        (task) =>
          task.status === 'pending' &&
          task.notBefore <= now() &&
          !isPrivateHealthUrl(task.url),
      )
    ) {
      return;
    }

    if (passRequested || continuationTimer) {
      return;
    }

    continuationTimer = setTimeout(() => {
      continuationTimer = null;
      void requestPass();
    }, continuationDelayMs);
  }

  async function claimNextTask(
    activeDomains: ReadonlySet<string>,
    activeUrls: ReadonlySet<string>,
    claimedAt: number,
  ): Promise<HealthCheckTask | null> {
    let claimed: HealthCheckTask | null = null;

    await cache.update((state) => {
      const candidates = state.tasks
        .filter((task) => {
          if (task.status !== 'pending' || task.notBefore > claimedAt) {
            return false;
          }
          if (isPrivateHealthUrl(task.url)) {
            return false;
          }
          if (activeUrls.has(task.url)) {
            return false;
          }
          const domain = getHealthDomain(task.url) ?? task.url;
          return !activeDomains.has(domain);
        })
        .sort(
          (left, right) =>
            left.priority - right.priority ||
            left.notBefore - right.notBefore ||
            left.createdAt - right.createdAt,
        );

      const task = candidates[0];
      if (!task) {
        return;
      }

      task.status = 'checking';
      task.startedAt = claimedAt;
      claimed = { ...task };
    });

    return claimed;
  }

  async function executeTask(task: HealthCheckTask): Promise<void> {
    let result: WebsiteHealthCheckResult;

    try {
      result = await checkUrl(task.url);
    } catch (error) {
      result = {
        status: 'unknown',
        responseTime: 0,
        method: 'HEAD',
        retryCount: 0,
        errorMessage: `无法确认网站状态：${getErrorMessage(error)}`,
      };
    }

    await cache.update((state) => {
      const existing = findHealthTask(state, task.url);
      if (!existing) {
        return;
      }
      const record = createHealthRecord(task.url, result, now());
      saveHealthRecord(state, record);
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
        notice: '已有检测任务正在进行',
      };
    }

    const referenced = sanitizeReferencedUrls(await getReferencedUrls());
    const urls =
      mode === 'abnormal'
        ? referenced.filter((url) => {
            const record = snapshot.records[url];
            return record ? isAbnormalHealthStatus(record.status) : false;
          })
        : referenced;

    if (urls.length === 0) {
      return {
        started: false,
        total: 0,
        notice:
          mode === 'abnormal'
            ? '当前没有可重新检测的异常网站'
            : '没有可检测的 HTTP/HTTPS 书签',
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
        upsertHealthTask(state, url, 'manual', startedAt, {
          notBefore: startedAt,
          batchId: scanId,
        });
      }

      started = true;
    });

    if (!started) {
      const latest = await cache.getSnapshot();
      return {
        started: false,
        total: latest.scan?.total ?? 0,
        notice: '已有检测任务正在进行',
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

/** 在任务完成/恢复时推进其所属扫描进度。 */
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
