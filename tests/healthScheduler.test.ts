import { describe, expect, it, vi } from 'vitest';
import {
  HEALTH_CACHE_RETENTION_MS,
  HEALTH_NEW_BOOKMARK_DELAY_MS,
  HEALTH_RETRY_DELAY_MS,
  HEALTH_RECOVERY_LIMIT,
  HEALTH_SCHEMA_VERSION,
  HEALTH_TASK_PRIORITY,
} from '../src/config/healthPolicy';
import { createHealthCacheService, saveHealthRecord, upsertHealthTask, type HealthStorageArea } from '../src/services/healthCacheService';
import { createHealthCheckScheduler } from '../src/services/healthCheckScheduler';
import type { WebsiteHealthCheckResult } from '../src/types/websiteHealth';

class MemoryStorage implements HealthStorageArea {
  data: Record<string, unknown> = {};
  writes = 0;

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.data[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writes += 1;
    Object.assign(this.data, items);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeout = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(5);
  }
  throw new Error('等待条件超时');
}

function healthyResult(): WebsiteHealthCheckResult {
  return {
    status: 'healthy',
    httpStatus: 200,
    responseTime: 5,
    method: 'HEAD',
    retryCount: 0,
  };
}

function setup(options: {
  urls?: string[];
  check?: (url: string) => Promise<WebsiteHealthCheckResult>;
  now?: () => number;
  globalConcurrency?: number;
  perDomainConcurrency?: number;
} = {}) {
  const storage = new MemoryStorage();
  let currentNow = 1_000;
  const now = options.now ?? (() => currentNow);
  const cache = createHealthCacheService(storage, now);
  const check = vi.fn(options.check ?? (async () => healthyResult()));
  const urls = options.urls ?? [];
  const scheduler = createHealthCheckScheduler({
    cache,
    checkUrl: check,
    getReferencedUrls: async () => urls,
    now,
    globalConcurrency: options.globalConcurrency ?? 3,
    perDomainConcurrency: options.perDomainConcurrency ?? 2,
  });
  return {
    storage,
    cache,
    check,
    scheduler,
    urls,
    get now() {
      return currentNow;
    },
    set now(value: number) {
      currentNow = value;
    },
  };
}

async function queueAll(
  scheduler: ReturnType<typeof createHealthCheckScheduler>,
  urls: string[],
  source: 'manual' | 'bookmark_created' = 'manual',
) {
  for (const url of urls) {
    await scheduler.queueBookmarkUrl(url, source);
  }
}

describe('健康检查调度器并发与队列', () => {
  it('全局并发不超过 3，同域并发不超过 2', async () => {
    const urls = [
      'https://a.example/1',
      'https://a.example/2',
      'https://a.example/3',
    ];
    let active = 0;
    let maxActive = 0;
    const domainActive = new Map<string, number>();
    let maxDomain = 0;

    const context = setup({
      urls,
      check: async (url) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const domain = new URL(url).hostname;
        const domainCount = (domainActive.get(domain) ?? 0) + 1;
        domainActive.set(domain, domainCount);
        maxDomain = Math.max(maxDomain, domainCount);
        await sleep(8);
        domainActive.set(domain, (domainActive.get(domain) ?? 1) - 1);
        active -= 1;
        return healthyResult();
      },
    });

    await queueAll(context.scheduler, urls);
    await context.scheduler.requestPass();

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxDomain).toBe(2);
    expect(context.check).toHaveBeenCalledTimes(3);
    const state = await context.cache.read();
    expect(Object.keys(state.records).sort()).toEqual(urls.sort());
  });

  it.each([0, 1, 10, 11, 20, 21])(
    '动态 worker 池一次处理 %i 个任务',
    async (count) => {
      const urls = Array.from(
        { length: count },
        (_, index) => `https://continuation-${index}.example/`,
      );
      const context = setup({ urls });

      const start = await context.scheduler.startScan('all');
      if (count === 0) {
        expect(start).toMatchObject({ started: false, total: 0 });
        await context.scheduler.requestPass();
        expect(context.check).not.toHaveBeenCalled();
        return;
      }

      expect(start).toMatchObject({ started: true, total: count });
      await context.scheduler.requestPass();
      expect(context.check).toHaveBeenCalledTimes(count);

      await waitFor(async () => {
        const state = await context.cache.read();
        return state.scan?.status === 'completed' && state.tasks.length === 0;
      });

      const snapshot = await context.cache.getSnapshot();
      expect(Object.keys(snapshot.records)).toHaveLength(count);
      expect(snapshot.scan).toMatchObject({
        status: 'completed',
        total: count,
        completed: count,
      });
    },
  );

  it('同一 URL 只保留一个任务，手动任务优先', async () => {
    const context = setup();
    await context.scheduler.queueBookmarkUrl('https://same.example/', 'scheduled');
    await context.scheduler.queueBookmarkUrl('https://same.example/', 'manual');

    const state = await context.cache.read();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.source).toBe('manual');
    expect(state.tasks[0]?.priority).toBe(HEALTH_TASK_PRIORITY.manual);
  });

  it('新增书签使用延迟任务，不会被立即执行', async () => {
    const context = setup();
    await context.scheduler.queueBookmarkUrl('https://new.example/', 'bookmark_created');
    const state = await context.cache.read();
    expect(state.tasks[0]?.notBefore).toBe(1_000 + HEALTH_NEW_BOOKMARK_DELAY_MS);

    await context.scheduler.requestPass();
    expect(context.check).not.toHaveBeenCalled();

    context.now = 1_000 + HEALTH_NEW_BOOKMARK_DELAY_MS;
    await context.scheduler.requestPass();
    expect(context.check).toHaveBeenCalledTimes(1);
  });

  it('内网地址不入队、不重检、不进入扫描', async () => {
    const context = setup({
      urls: [
        'http://127.0.0.1:43123/private',
        'http://192.168.1.2/',
        'https://public.example/',
      ],
    });

    await context.scheduler.queueBookmarkUrl('http://127.0.0.1:43123/private', 'manual');
    const queued = await context.cache.read();
    expect(queued.tasks).toHaveLength(0);
    expect(await context.scheduler.recheck('http://192.168.1.2/')).toBe(false);

    const start = await context.scheduler.startScan('all');
    expect(start).toMatchObject({ started: true, total: 1 });
    await context.scheduler.requestPass();
    expect(context.check).toHaveBeenCalledTimes(1);
    expect(context.check).toHaveBeenCalledWith('https://public.example/', 1);
  });
});

describe('导入书签批量入队', () => {
  it('空导入不创建任务', async () => {
    const context = setup();
    await context.scheduler.queueBookmarkUrls([], 'bookmark_created');
    expect((await context.cache.read()).tasks).toHaveLength(0);
  });

  it('单个、多个、重复、非 HTTP 和内网 URL 只保留可检测去重项', async () => {
    const context = setup();
    await context.scheduler.queueBookmarkUrls(
      [
        'https://a.example/',
        'https://a.example/',
        'https://b.example/',
        'chrome://settings',
        'http://127.0.0.1:43123/',
        'not a url',
      ],
      'bookmark_created',
    );

    const state = await context.cache.read();
    expect(state.tasks.map((task) => task.url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
    expect(state.tasks.every((task) => task.source === 'bookmark_created')).toBe(true);
    expect(context.check).not.toHaveBeenCalled();
  });

  it('跳过仍然新鲜的缓存记录，保留过期记录', async () => {
    const context = setup();
    await context.cache.update((state) => {
      saveHealthRecord(state, {
        url: 'https://fresh.example/',
        status: 'healthy',
        checkedAt: 1_000,
        nextCheckAt: 10_000,
        method: 'HEAD',
      });
      saveHealthRecord(state, {
        url: 'https://stale.example/',
        status: 'unknown',
        checkedAt: 100,
        nextCheckAt: 500,
        method: 'HEAD',
      });
    });

    await context.scheduler.queueBookmarkUrls(
      ['https://fresh.example/', 'https://stale.example/'],
      'bookmark_created',
    );

    const state = await context.cache.read();
    expect(state.tasks.map((task) => task.url)).toEqual(['https://stale.example/']);
  });

  it('已有任务不会因重复导入再次创建', async () => {
    const context = setup();
    await context.scheduler.queueBookmarkUrls(['https://same.example/'], 'bookmark_created');
    await context.scheduler.queueBookmarkUrls(['https://same.example/'], 'bookmark_created');

    const state = await context.cache.read();
    expect(state.tasks).toHaveLength(1);
  });
});

describe('健康检查扫描进度与取消', () => {
  it('全量扫描完成任务后记录进度并结束', async () => {
    const urls = ['https://a.example/', 'https://b.example/', 'https://c.example/'];
    const context = setup({ urls });

    const start = await context.scheduler.startScan('all');
    expect(start).toMatchObject({ started: true, total: 3 });
    await context.scheduler.requestPass();

    const snapshot = await context.cache.getSnapshot();
    expect(snapshot.scan).toMatchObject({
      status: 'completed',
      total: 3,
      completed: 3,
    });
    expect(snapshot.scan?.finishedAt).toBeDefined();
    expect(context.check).toHaveBeenCalledTimes(3);
  });

  it('取消扫描会移除尚未执行的批量任务，并忽略进行中的结果', async () => {
    const urls = [
      'https://a.example/',
      'https://b.example/',
      'https://c.example/',
      'https://d.example/',
      'https://e.example/',
    ];
    const resolvers: Array<() => void> = [];
    const context = setup({
      urls,
      check: (url) =>
        new Promise<WebsiteHealthCheckResult>((resolve) => {
          resolvers.push(() => resolve(healthyResult()));
          void url;
        }),
    });

    await context.scheduler.startScan('all');
    await waitFor(() => resolvers.length === 3);
    await context.scheduler.cancelScan();
    expect(resolvers).toHaveLength(3);

    for (const resolve of resolvers) resolve();
    await context.scheduler.requestPass();

    const snapshot = await context.cache.getSnapshot();
    expect(snapshot.scan?.status).toBe('cancelled');
    expect(snapshot.scan?.completed).toBe(0);
    expect(context.check).toHaveBeenCalledTimes(3);
    expect(snapshot.pendingUrls).toHaveLength(0);
  });

  it('异常扫描只选择明确异常的状态', async () => {
    const urls = ['https://404.example/', 'https://500.example/', 'https://ok.example/'];
    const context = setup({ urls });
    await context.cache.update((state) => {
      for (const [url, status] of [
        ['https://404.example/', 'not_found'],
        ['https://500.example/', 'server_error'],
        ['https://ok.example/', 'healthy'],
      ] as const) {
        saveHealthRecord(state, {
          url,
          status,
          httpStatus: status === 'not_found' ? 404 : 200,
          checkedAt: 1_000,
          nextCheckAt: 999_999,
          method: 'HEAD',
          responseTime: 1,
        });
      }
    });

    const start = await context.scheduler.startScan('abnormal');
    expect(start).toMatchObject({ started: true, total: 2 });
    await context.scheduler.requestPass();

    expect(context.check.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://404.example/',
      'https://500.example/',
    ]);
  });
});

describe('健康检查过期、恢复与清理', () => {
  it('缓存过期时自动加入 scheduled 任务', async () => {
    const url = 'https://expired.example/';
    const context = setup({ urls: [url] });
    await context.cache.update((state) => {
      saveHealthRecord(state, {
        url,
        status: 'healthy',
        checkedAt: 100,
        nextCheckAt: 500,
        method: 'HEAD',
      });
    });

    await context.scheduler.requestPass();

    expect(context.check).toHaveBeenCalledWith(url, 1);
    const state = await context.cache.read();
    expect(state.records[url]?.checkedAt).toBe(1_000);
  });

  it('Service Worker 重启后恢复 checking 任务并完成扫描', async () => {
    const url = 'https://resume.example/';
    const context = setup({ urls: [url] });
    await context.cache.update((state) => {
      state.scan = {
        id: 'scan-resume',
        mode: 'all',
        status: 'running',
        total: 1,
        completed: 0,
        startedAt: 900,
      };
      upsertHealthTask(state, url, 'manual', 900, {
        batchId: 'scan-resume',
      });
      const task = state.tasks[0];
      if (task) {
        task.status = 'checking';
        task.startedAt = 950;
      }
    });

    await context.scheduler.initialize();
    const recovered = await context.cache.read();
    expect(recovered.tasks[0]?.status).toBe('pending');
    expect(recovered.tasks[0]?.recoveryCount).toBe(1);

    await context.scheduler.requestPass();
    const final = await context.cache.getSnapshot();
    expect(final.scan?.status).toBe('completed');
    expect(final.scan?.completed).toBe(1);
    expect(context.check).toHaveBeenCalledWith(url, 1);
  });

  it('初始化失败后下一次事件可以重新恢复', async () => {
    const url = 'https://retry-recovery.example/';
    const context = setup({ urls: [url] });
    await context.cache.update((state) => {
      state.scan = {
        id: 'scan-retry',
        mode: 'all',
        status: 'running',
        total: 1,
        completed: 0,
        startedAt: 900,
      };
      upsertHealthTask(state, url, 'manual', 900, { batchId: 'scan-retry' });
      const task = state.tasks[0];
      if (task) {
        task.status = 'checking';
        task.startedAt = 950;
      }
    });

    const originalSet = context.storage.set.bind(context.storage);
    let failed = false;
    context.storage.set = async (items) => {
      if (!failed) {
        failed = true;
        throw new Error('storage unavailable');
      }
      await originalSet(items);
    };

    await expect(context.scheduler.initialize()).rejects.toThrow(
      'storage unavailable',
    );

    await context.scheduler.initialize();
    const recovered = await context.cache.read();
    expect(recovered.tasks[0]?.status).toBe('pending');
    expect(recovered.tasks[0]?.recoveryCount).toBe(1);
  });

  it('连续中断超过限制时转成 unknown，不再无限重试', async () => {
    const url = 'https://stuck.example/';
    const context = setup({ urls: [url] });
    await context.cache.update((state) => {
      upsertHealthTask(state, url, 'manual', 900);
      const task = state.tasks[0];
      if (task) {
        task.status = 'checking';
        task.startedAt = 950;
        task.recoveryCount = HEALTH_RECOVERY_LIMIT;
      }
    });

    await context.scheduler.initialize();
    const state = await context.cache.read();
    expect(state.tasks).toHaveLength(0);
    expect(state.records[url]?.status).toBe('unknown');
    expect(state.records[url]?.errorMessage).toContain('中断');
  });

  it('清理不再被引用的任务和超过保留期的记录', async () => {
    const context = setup({ urls: [] });
    await context.cache.update((state) => {
      upsertHealthTask(state, 'https://gone.example/', 'manual', 1_000);
      saveHealthRecord(state, {
        url: 'https://gone.example/',
        status: 'not_found',
        checkedAt: 1_000 - HEALTH_CACHE_RETENTION_MS - 1,
        nextCheckAt: 100,
        method: 'HEAD',
      });
    });

    await context.scheduler.cleanupOrphans();
    const state = await context.cache.read();
    expect(state.tasks).toHaveLength(0);
    expect(state.records['https://gone.example/']).toBeUndefined();
  });
});

describe('健康检查两阶段复查', () => {
  it('首次无法确认时进入第二阶段，且不提前完成扫描', async () => {
    const url = 'https://retry.example/';
    let calls = 0;
    const context = setup({
      urls: [url],
      check: async () => {
        calls += 1;
        return calls === 1
          ? {
              status: 'unknown',
              responseTime: 3_000,
              method: 'HEAD',
              retryCount: 0,
              errorMessage: '请求超时',
            }
          : healthyResult();
      },
    });

    await context.scheduler.startScan('all');
    await context.scheduler.requestPass();

    let state = await context.cache.read();
    expect(calls).toBe(1);
    expect(state.tasks[0]?.attempt).toBe(2);
    expect(state.scan?.status).toBe('running');

    context.now += HEALTH_RETRY_DELAY_MS + 1;
    await context.scheduler.requestPass();

    state = await context.cache.read();
    expect(calls).toBe(2);
    expect(state.records[url]?.status).toBe('healthy');
    expect(state.scan).toMatchObject({ status: 'completed', completed: 1 });
  });
});
describe('健康检查动态并发基准（可控 mock）', () => {
  it('9 个不同域名使用完整并发池', async () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://nine-${i}.example/`);
    let active = 0;
    let maxActive = 0;
    const context = setup({
      urls,
      globalConcurrency: 6,
      check: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(25);
        active -= 1;
        return healthyResult();
      },
    });

    await context.scheduler.startScan('all');
    const startedAt = Date.now();
    await context.scheduler.requestPass();
    const elapsed = Date.now() - startedAt;

    expect(maxActive).toBe(6);
    expect(context.check).toHaveBeenCalledTimes(9);
    expect(elapsed).toBeLessThan(9 * 25);
  });

  it('20 个不同域名没有批次等待', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://twenty-${i}.example/`);
    let active = 0;
    let maxActive = 0;
    const context = setup({
      urls,
      globalConcurrency: 6,
      check: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(25);
        active -= 1;
        return healthyResult();
      },
    });

    await context.scheduler.startScan('all');
    const startedAt = Date.now();
    await context.scheduler.requestPass();
    const elapsed = Date.now() - startedAt;

    expect(maxActive).toBe(6);
    expect(context.check).toHaveBeenCalledTimes(20);
    // 固定 10 个/批至少需要两批；动态池应接近 4 个 25ms 波次。
    expect(elapsed).toBeLessThan(20 * 25);
  });
});
describe('健康检查同域限流基准', () => {
  it('20 个同域 URL 遵守每域 2 并发', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://same.example/${i}`);
    let active = 0;
    let maxActive = 0;
    const context = setup({
      urls,
      globalConcurrency: 6,
      perDomainConcurrency: 2,
      check: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(10);
        active -= 1;
        return healthyResult();
      },
    });

    await context.scheduler.startScan('all');
    await context.scheduler.requestPass();

    expect(maxActive).toBe(2);
    expect(context.check).toHaveBeenCalledTimes(20);
  });
});

describe('健康缓存写入合并', () => {
  it('20 个 URL 的扫描合并 claim/complete 写入，且状态与进度保持一致', async () => {
    const count = 20;
    const urls = Array.from(
      { length: count },
      (_, index) => `https://batch-${index}.example/`,
    );
    const releases: Array<() => void> = [];

    const context = setup({
      urls,
      globalConcurrency: 6,
      perDomainConcurrency: 2,
      check: () =>
        new Promise<WebsiteHealthCheckResult>((resolve) => {
          releases.push(() => resolve(healthyResult()));
        }),
    });

    await context.scheduler.startScan('all');
    const pass = context.scheduler.requestPass();

    // 每次等一批请求挂起后一起放行，让同一批结果落在同一轮事件循环里。
    let cursor = 0;
    while (cursor < count) {
      await waitFor(() => releases.length > cursor);
      const wave = releases.slice(cursor);
      cursor = releases.length;
      for (const release of wave) {
        release();
      }
    }
    await pass;

    const snapshot = await context.cache.getSnapshot();
    expect(context.check).toHaveBeenCalledTimes(count);
    expect(Object.keys(snapshot.records)).toHaveLength(count);
    expect(snapshot.pendingUrls).toEqual([]);
    expect(snapshot.checkingUrls).toEqual([]);
    expect(snapshot.schemaVersion).toBe(HEALTH_SCHEMA_VERSION);
    expect(snapshot.scan).toMatchObject({
      status: 'completed',
      total: count,
      completed: count,
    });

    // 优化前每个任务 claim + complete 各写一次全量状态，共 2 * count + 2 = 42 次。
    // 合并后只剩每波一次 claim 写入 + 一次完成写入。
    expect(context.storage.writes).toBeLessThan(2 * count);
    expect(context.storage.writes).toBeLessThanOrEqual(12);
  });
});