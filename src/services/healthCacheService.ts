import {
  HEALTH_CACHE_RETENTION_MS,
  HEALTH_SCHEMA_VERSION,
  HEALTH_STATE_STORAGE_KEY,
  HEALTH_TASK_PRIORITY,
} from '../config/healthPolicy';
import type {
  HealthCheckTask,
  HealthScanState,
  HealthSnapshot,
  HealthStorageState,
  HealthTaskSource,
  WebsiteHealthRecord,
} from '../types/websiteHealth';
import { isStoredHealthStatus } from '../utils/healthStatus';
import { normalizeHealthUrl } from '../utils/healthUrl';
import { t } from '../i18n';

export interface HealthStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface HealthCacheService {
  read(): Promise<HealthStorageState>;
  update(mutator: (state: HealthStorageState) => void): Promise<HealthStorageState>;
  getSnapshot(): Promise<HealthSnapshot>;
}

export interface UpsertTaskOptions {
  notBefore?: number;
  batchId?: string;
}

export function createEmptyHealthState(now = Date.now()): HealthStorageState {
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    records: {},
    tasks: [],
    scan: null,
    ignoredUrls: [],
    updatedAt: now,
  };
}

interface PendingWrite {
  mutator: (state: HealthStorageState) => void;
  resolve: (state: HealthStorageState) => void;
  reject: (error: unknown) => void;
  failed: boolean;
  error: unknown;
}

/**
 * 只比较真正会落盘的业务字段；`updatedAt` 由服务自己维护，不参与比较，
 * 这样「改完和改前一样」的更新可以直接跳过写入。
 */
function fingerprint(state: HealthStorageState): string {
  return JSON.stringify([
    state.records,
    state.tasks,
    state.scan,
    state.ignoredUrls,
  ]);
}

/**
 * 创建 health 缓存服务。
 *
 * storage.local 中只保存检测记录、任务与进度，不保存书签树。
 *
 * 写入策略：同一轮事件循环里提交的多个 update 合并成一次
 * 「读一次 → 依次执行 mutator → 写一次」，因此 N 个任务的 claim/complete
 * 不再各自做一次全量读改写；而每个 update 的 Promise 仍然只在对应写入
 * 完成（或被判定为无变化）之后才 resolve，调用方感知到的持久化语义不变。
 */
export function createHealthCacheService(
  storageArea: HealthStorageArea = resolveHealthStorage(),
  now: () => number = Date.now,
): HealthCacheService {
  let writeChain: Promise<void> = Promise.resolve();
  let pending: PendingWrite[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushLoop: Promise<void> | null = null;

  async function readRaw(): Promise<HealthStorageState> {
    const stored = await storageArea.get(HEALTH_STATE_STORAGE_KEY);
    return normalizeHealthState(stored[HEALTH_STATE_STORAGE_KEY], now());
  }

  async function read(): Promise<HealthStorageState> {
    await flushPending();
    return readRaw();
  }

  /** 排空待写队列，让随后的 read 能看到所有已提交的 update。 */
  async function flushPending(): Promise<void> {
    while (pending.length > 0 || flushLoop) {
      await runFlush();
    }
    await writeChain;
  }

  function scheduleFlush(): void {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void runFlush();
    }, 0);
  }

  function runFlush(): Promise<void> {
    if (flushLoop) {
      return flushLoop;
    }

    const loop = (async () => {
      await writeChain;
      while (pending.length > 0) {
        const batch = pending;
        pending = [];
        await commitBatch(batch);
      }
    })().then(
      () => {
        flushLoop = null;
        if (pending.length > 0) {
          scheduleFlush();
        }
      },
      () => {
        flushLoop = null;
        if (pending.length > 0) {
          scheduleFlush();
        }
      },
    );

    flushLoop = loop;
    return loop;
  }

  async function commitBatch(batch: PendingWrite[]): Promise<void> {
    const operation = writeChain.then(async () => {
      const state = await readRaw();
      const before = fingerprint(state);

      for (const item of batch) {
        try {
          item.mutator(state);
        } catch (error) {
          item.failed = true;
          item.error = error;
        }
      }

      state.schemaVersion = HEALTH_SCHEMA_VERSION;
      if (fingerprint(state) !== before) {
        state.updatedAt = now();
        await storageArea.set({ [HEALTH_STATE_STORAGE_KEY]: state });
      }
      return state;
    });

    writeChain = operation.then(
      () => undefined,
      () => undefined,
    );

    try {
      const state = await operation;
      for (const item of batch) {
        if (item.failed) {
          item.reject(item.error);
        } else {
          item.resolve(state);
        }
      }
    } catch (error) {
      for (const item of batch) {
        item.reject(error);
      }
    }
  }

  function update(
    mutator: (state: HealthStorageState) => void,
  ): Promise<HealthStorageState> {
    return new Promise<HealthStorageState>((resolve, reject) => {
      pending.push({
        mutator,
        resolve,
        reject,
        failed: false,
        error: null,
      });
      scheduleFlush();
    });
  }

  return {
    read,
    update,
    async getSnapshot() {
      return buildHealthSnapshot(await read());
    },
  };
}

function resolveHealthStorage(): HealthStorageArea {
  if (
    typeof chrome === 'undefined' ||
    !chrome.storage ||
    !chrome.storage.local
  ) {
    throw new Error(t('health.error.storageUnavailable'));
  }
  return chrome.storage.local as unknown as HealthStorageArea;
}

/**
 * 校验并迁移 storage 中的状态。
 *
 * 当前 schemaVersion=1；未来升级时可在此处加入逐版本迁移。
 * 遇到未知版本时清空缓存，避免把不同结构误当成当前数据。
 */
export function normalizeHealthState(
  raw: unknown,
  now = Date.now(),
): HealthStorageState {
  if (!isRecord(raw)) {
    return createEmptyHealthState(now);
  }

  if (raw.schemaVersion !== HEALTH_SCHEMA_VERSION) {
    console.warn('[Bookmark Home] 健康检查缓存版本不兼容，已重置');
    return createEmptyHealthState(now);
  }

  const state = createEmptyHealthState(now);
  state.updatedAt = finiteNumber(raw.updatedAt, now);

  if (isRecord(raw.records)) {
    for (const [rawKey, rawRecord] of Object.entries(raw.records)) {
      const record = normalizeRecord(rawKey, rawRecord);
      if (record) {
        state.records[record.url] = record;
      }
    }
  }

  if (Array.isArray(raw.tasks)) {
    const tasks = new Map<string, HealthCheckTask>();
    for (const rawTask of raw.tasks) {
      const task = normalizeTask(rawTask);
      if (task) {
        tasks.set(task.url, task);
      }
    }
    state.tasks = [...tasks.values()];
  }

  if (isRecord(raw.scan)) {
    state.scan = normalizeScan(raw.scan);
  }

  if (Array.isArray(raw.ignoredUrls)) {
    const ignored = new Set<string>();
    for (const value of raw.ignoredUrls) {
      const url = typeof value === 'string' ? normalizeHealthUrl(value) : null;
      if (url) {
        ignored.add(url);
      }
    }
    state.ignoredUrls = [...ignored];
  }

  return state;
}

function normalizeRecord(
  key: string,
  raw: unknown,
): WebsiteHealthRecord | null {
  if (!isRecord(raw)) {
    return null;
  }

  const url =
    normalizeHealthUrl(typeof raw.url === 'string' ? raw.url : key) ??
    normalizeHealthUrl(key);
  if (!url) {
    return null;
  }

  const status = raw.status;
  if (!isStoredHealthStatus(status)) {
    return null;
  }

  const checkedAt = finiteNumber(raw.checkedAt, NaN);
  const nextCheckAt = finiteNumber(raw.nextCheckAt, NaN);
  const method = raw.method === 'HEAD' || raw.method === 'GET' ? raw.method : null;
  if (!Number.isFinite(checkedAt) || !Number.isFinite(nextCheckAt) || !method) {
    return null;
  }

  const record: WebsiteHealthRecord = {
    url,
    status,
    checkedAt,
    nextCheckAt,
    method,
  };

  const httpStatus = finiteNumber(raw.httpStatus, NaN);
  if (Number.isFinite(httpStatus)) {
    record.httpStatus = httpStatus;
  }

  if (typeof raw.finalUrl === 'string') {
    const finalUrl = normalizeHealthUrl(raw.finalUrl);
    if (finalUrl) {
      record.finalUrl = finalUrl;
    }
  }

  const responseTime = finiteNumber(raw.responseTime, NaN);
  if (Number.isFinite(responseTime)) {
    record.responseTime = responseTime;
  }

  if (typeof raw.errorMessage === 'string' && raw.errorMessage.length > 0) {
    record.errorMessage = raw.errorMessage;
  }

  const retryCount = finiteNumber(raw.retryCount, NaN);
  if (Number.isFinite(retryCount) && retryCount > 0) {
    record.retryCount = retryCount;
  }

  return record;
}

function normalizeTask(raw: unknown): HealthCheckTask | null {
  if (!isRecord(raw)) {
    return null;
  }

  const url = normalizeHealthUrl(typeof raw.url === 'string' ? raw.url : null);
  const source = raw.source;
  if (
    !url ||
    (source !== 'manual' &&
      source !== 'scheduled' &&
      source !== 'bookmark_created')
  ) {
    return null;
  }

  const status = raw.status === 'checking' ? 'checking' : 'pending';
  const createdAt = finiteNumber(raw.createdAt, NaN);
  const notBefore = finiteNumber(raw.notBefore, createdAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(notBefore)) {
    return null;
  }

  const task: HealthCheckTask = {
    url,
    source,
    priority: finiteNumber(raw.priority, HEALTH_TASK_PRIORITY[source]),
    createdAt,
    notBefore,
    status,
    recoveryCount: Math.max(0, Math.floor(finiteNumber(raw.recoveryCount, 0))),
  };

  if (typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)) {
    task.startedAt = raw.startedAt;
  }
  if (typeof raw.batchId === 'string' && raw.batchId.length > 0) {
    task.batchId = raw.batchId;
  }
  if (raw.attempt === 2) {
    task.attempt = 2;
  }

  return task;
}

function normalizeScan(raw: Record<string, unknown>): HealthScanState | null {
  if (
    typeof raw.id !== 'string' ||
    (raw.mode !== 'all' && raw.mode !== 'abnormal') ||
    (raw.status !== 'running' &&
      raw.status !== 'completed' &&
      raw.status !== 'cancelled')
  ) {
    return null;
  }

  const total = Math.max(0, Math.floor(finiteNumber(raw.total, 0)));
  const completed = Math.min(
    total,
    Math.max(0, Math.floor(finiteNumber(raw.completed, 0))),
  );
  const startedAt = finiteNumber(raw.startedAt, NaN);
  if (!Number.isFinite(startedAt)) {
    return null;
  }

  const scan: HealthScanState = {
    id: raw.id,
    mode: raw.mode,
    status: raw.status,
    total,
    completed,
    startedAt,
  };

  if (typeof raw.finishedAt === 'number' && Number.isFinite(raw.finishedAt)) {
    scan.finishedAt = raw.finishedAt;
  }

  return scan;
}

export function saveHealthRecord(
  state: HealthStorageState,
  record: WebsiteHealthRecord,
): void {
  state.records[record.url] = record;
}

export function findHealthTask(
  state: HealthStorageState,
  normalizedUrl: string,
): HealthCheckTask | null {
  return state.tasks.find((task) => task.url === normalizedUrl) ?? null;
}

export function getExpiredHealthRecords(
  state: HealthStorageState,
  now: number,
): WebsiteHealthRecord[] {
  return Object.values(state.records).filter(
    (record) => record.nextCheckAt <= now,
  );
}

/**
 * 新增/升级任务。
 *
 * 同一 URL 只保留一条任务；更高优先级会覆盖低优先级来源。
 * 已处于 checking 的任务保留开始时间，避免内存中断时重复启动。
 */
export function upsertHealthTask(
  state: HealthStorageState,
  normalizedUrl: string,
  source: HealthTaskSource,
  now: number,
  options: UpsertTaskOptions = {},
): HealthCheckTask {
  const requestedNotBefore = options.notBefore ?? now;
  const priority = HEALTH_TASK_PRIORITY[source];
  const existing = state.tasks.find((task) => task.url === normalizedUrl);

  if (existing) {
    if (priority < existing.priority) {
      existing.priority = priority;
      existing.source = source;
    }
    existing.notBefore = Math.min(existing.notBefore, requestedNotBefore);
    if (options.batchId !== undefined) {
      existing.batchId = options.batchId;
    }
    return existing;
  }

  const task: HealthCheckTask = {
    url: normalizedUrl,
    source,
    priority,
    createdAt: now,
    notBefore: requestedNotBefore,
    status: 'pending',
    recoveryCount: 0,
  };

  if (options.batchId !== undefined) {
    task.batchId = options.batchId;
  }

  state.tasks.push(task);
  return task;
}

export function pruneHealthState(
  state: HealthStorageState,
  referencedUrls: ReadonlySet<string>,
  now: number,
): void {
  state.tasks = state.tasks.filter((task) => referencedUrls.has(task.url));
  state.ignoredUrls = state.ignoredUrls.filter((url) => referencedUrls.has(url));

  for (const [url, record] of Object.entries(state.records)) {
    if (referencedUrls.has(url)) {
      continue;
    }
    if (now - record.checkedAt >= HEALTH_CACHE_RETENTION_MS) {
      delete state.records[url];
    }
  }

  reconcileScanState(state, now);
}

/** 如果当前扫描没有剩余任务，则结束扫描，避免进度永远停在 running。 */
export function reconcileScanState(
  state: HealthStorageState,
  now: number,
): void {
  const scan = state.scan;
  if (!scan || scan.status !== 'running') {
    return;
  }

  const remaining = state.tasks.some((task) => task.batchId === scan.id);
  if (!remaining) {
    scan.status = 'completed';
    scan.completed = Math.min(scan.total, scan.completed);
    scan.finishedAt = now;
  }
}

export function buildHealthSnapshot(state: HealthStorageState): HealthSnapshot {
  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    records: { ...state.records },
    pendingUrls: state.tasks
      .filter((task) => task.status === 'pending')
      .map((task) => task.url),
    checkingUrls: state.tasks
      .filter((task) => task.status === 'checking')
      .map((task) => task.url),
    retryUrls: state.tasks
      .filter((task) => task.status === 'pending' && task.attempt === 2)
      .map((task) => task.url),
    ignoredUrls: [...state.ignoredUrls],
    scan: state.scan ? { ...state.scan } : null,
    updatedAt: state.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
