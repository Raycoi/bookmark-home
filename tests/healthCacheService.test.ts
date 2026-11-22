import { describe, expect, it } from 'vitest';
import {
  HEALTH_CACHE_RETENTION_MS,
  HEALTH_SCHEMA_VERSION,
  HEALTH_STATE_STORAGE_KEY,
  HEALTH_TASK_PRIORITY,
} from '../src/config/healthPolicy';
import {
  buildHealthSnapshot,
  createEmptyHealthState,
  createHealthCacheService,
  findHealthTask,
  getExpiredHealthRecords,
  normalizeHealthState,
  pruneHealthState,
  reconcileScanState,
  saveHealthRecord,
  upsertHealthTask,
  type HealthStorageArea,
} from '../src/services/healthCacheService';
import type {
  HealthScanState,
  WebsiteHealthRecord,
} from '../src/types/websiteHealth';

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

function makeRecord(
  url: string,
  status: WebsiteHealthRecord['status'] = 'healthy',
  checkedAt = 1_000,
): WebsiteHealthRecord {
  return {
    url,
    status,
    checkedAt,
    nextCheckAt: checkedAt + 7 * 24 * 60 * 60 * 1000,
    method: 'HEAD',
    responseTime: 25,
  };
}

describe('健康缓存状态模型', () => {
  it('保存记录', () => {
    const state = createEmptyHealthState();
    saveHealthRecord(state, makeRecord('https://a.example/'));
    saveHealthRecord(state, makeRecord('https://b.example/'));

    expect(state.records['https://a.example/']?.url).toBe(
      'https://a.example/',
    );
    expect(Object.keys(state.records)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  });

  it('任务按 URL 去重，手动优先级覆盖后台任务', () => {
    const state = createEmptyHealthState();
    const scheduled = upsertHealthTask(
      state,
      'https://a.example/',
      'scheduled',
      1_000,
    );
    const manual = upsertHealthTask(
      state,
      'https://a.example/',
      'manual',
      2_000,
    );

    expect(state.tasks).toHaveLength(1);
    expect(scheduled).toBe(manual);
    expect(manual.priority).toBe(HEALTH_TASK_PRIORITY.manual);
    expect(manual.source).toBe('manual');
    expect(manual.notBefore).toBe(1_000);
  });

  it('查询任务', () => {
    const state = createEmptyHealthState();
    upsertHealthTask(state, 'https://a.example/', 'manual', 1_000);
    expect(findHealthTask(state, 'https://a.example/')?.source).toBe('manual');
    expect(findHealthTask(state, 'https://missing.example/')).toBeNull();
  });

  it('快照包含 pending/checking URL 和扫描进度', () => {
    const state = createEmptyHealthState();
    upsertHealthTask(state, 'https://pending.example/', 'scheduled', 1_000);
    const checking = upsertHealthTask(
      state,
      'https://checking.example/',
      'manual',
      1_000,
    );
    checking.status = 'checking';
    state.scan = {
      id: 'scan-1',
      mode: 'all',
      status: 'running',
      total: 2,
      completed: 0,
      startedAt: 1_000,
    };

    const snapshot = buildHealthSnapshot(state);
    expect(snapshot.pendingUrls).toEqual(['https://pending.example/']);
    expect(snapshot.checkingUrls).toEqual(['https://checking.example/']);
    expect(snapshot.scan?.id).toBe('scan-1');
    expect(snapshot.schemaVersion).toBe(HEALTH_SCHEMA_VERSION);
  });
});

describe('缓存有效期与清理', () => {
  it('清理未被引用且超过保留期的记录，但保留仍被引用的 URL', () => {
    const state = createEmptyHealthState();
    const old = 1_000;
    const now = old + HEALTH_CACHE_RETENTION_MS + 1;
    saveHealthRecord(state, makeRecord('https://keep.example/', 'server_error', old));
    saveHealthRecord(state, makeRecord('https://old.example/', 'not_found', old));

    pruneHealthState(state, new Set(['https://keep.example/']), now);

    expect(state.records['https://keep.example/']).toBeDefined();
    expect(state.records['https://old.example/']).toBeUndefined();
  });

  it('未超过保留期的孤儿记录不会被立即删除', () => {
    const state = createEmptyHealthState();
    const now = 1_000;
    saveHealthRecord(state, makeRecord('https://orphan.example/', 'not_found', now));
    pruneHealthState(state, new Set(), now);
    expect(state.records['https://orphan.example/']).toBeDefined();
  });

  it('不会一次性按状态清理所有异常记录', () => {
    const state = createEmptyHealthState();
    const now = 1_000;
    for (const [url, status] of [
      ['https://404.example/', 'not_found'],
      ['https://500.example/', 'server_error'],
      ['https://ok.example/', 'healthy'],
    ] as const) {
      saveHealthRecord(state, makeRecord(url, status, now));
    }
    pruneHealthState(state, new Set(), now);
    expect(Object.keys(state.records)).toHaveLength(3);
  });

  it('清理不再被引用的任务', () => {
    const state = createEmptyHealthState();
    upsertHealthTask(state, 'https://keep.example/', 'scheduled', 1_000);
    upsertHealthTask(state, 'https://gone.example/', 'scheduled', 1_000);

    pruneHealthState(state, new Set(['https://keep.example/']), 2_000);

    expect(state.tasks.map((task) => task.url)).toEqual(['https://keep.example/']);
  });

  it('扫描任务全部消失时自动收敛为 completed', () => {
    const state = createEmptyHealthState();
    const scan: HealthScanState = {
      id: 'scan-1',
      mode: 'all',
      status: 'running',
      total: 1,
      completed: 1,
      startedAt: 1_000,
    };
    state.scan = scan;
    reconcileScanState(state, 2_000);
    expect(scan.status).toBe('completed');
    expect(scan.finishedAt).toBe(2_000);
  });

  it('列出已过期记录', () => {
    const state = createEmptyHealthState();
    const old = makeRecord('https://old.example/', 'unknown', 1_000);
    old.nextCheckAt = 2_000;
    saveHealthRecord(state, old);
    const fresh = makeRecord('https://fresh.example/', 'healthy', 1_000);
    fresh.nextCheckAt = 10_000;
    saveHealthRecord(state, fresh);

    expect(getExpiredHealthRecords(state, 5_000).map((record) => record.url)).toEqual([
      'https://old.example/',
    ]);
  });
});

describe('health storage 版本与并发', () => {
  it('未知版本会重置为空状态', () => {
    const storage = new MemoryStorage();
    storage.data[HEALTH_STATE_STORAGE_KEY] = {
      schemaVersion: 99,
      records: { 'https://a.example/': makeRecord('https://a.example/') },
    };
    const state = normalizeHealthState(storage.data[HEALTH_STATE_STORAGE_KEY]);
    expect(state.records).toEqual({});
    expect(state.tasks).toEqual([]);
    expect(state.schemaVersion).toBe(HEALTH_SCHEMA_VERSION);
  });

  it('缓存服务串行化并发更新，不丢任务，并合并为一次写入', async () => {
    const storage = new MemoryStorage();
    const cache = createHealthCacheService(storage, () => 1_000);

    await Promise.all([
      cache.update((state) => {
        upsertHealthTask(state, 'https://a.example/', 'manual', 1_000);
      }),
      cache.update((state) => {
        upsertHealthTask(state, 'https://b.example/', 'scheduled', 1_000);
      }),
    ]);

    const state = await cache.read();
    expect(state.tasks.map((task) => task.url).sort()).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
    // 同一轮事件循环提交的两个 update 合并成一次全量写入（优化前是 2 次）。
    expect(storage.writes).toBe(1);
  });

  it('同批并发更新共享一次写入，read 能看到全部结果', async () => {
    const storage = new MemoryStorage();
    const cache = createHealthCacheService(storage, () => 1_000);

    await Promise.all([
      cache.update((state) => {
        upsertHealthTask(state, 'https://a.example/', 'manual', 1_000);
      }),
      cache.update((state) => {
        saveHealthRecord(state, makeRecord('https://b.example/'));
      }),
      cache.update((state) => {
        state.ignoredUrls.push('https://c.example/');
      }),
    ]);

    expect(storage.writes).toBe(1);

    const state = await cache.read();
    expect(state.tasks.map((task) => task.url)).toEqual(['https://a.example/']);
    expect(Object.keys(state.records)).toEqual(['https://b.example/']);
    expect(state.ignoredUrls).toEqual(['https://c.example/']);
    expect(state.schemaVersion).toBe(HEALTH_SCHEMA_VERSION);
  });

  it('read 会先落盘尚未合并的写入', async () => {
    const storage = new MemoryStorage();
    const cache = createHealthCacheService(storage, () => 1_000);

    const write = cache.update((state) => {
      upsertHealthTask(state, 'https://a.example/', 'manual', 1_000);
    });
    const state = await cache.read();
    await write;

    expect(state.tasks.map((task) => task.url)).toEqual(['https://a.example/']);
    expect(storage.writes).toBe(1);
    const stored = storage.data[HEALTH_STATE_STORAGE_KEY] as {
      tasks: unknown[];
    };
    expect(stored.tasks).toHaveLength(1);
  });

  it('无实际变化的更新不写 storage，也不推进 updatedAt', async () => {
    const storage = new MemoryStorage();
    let now = 1_000;
    const cache = createHealthCacheService(storage, () => now);

    await cache.update((state) => {
      upsertHealthTask(state, 'https://a.example/', 'manual', 1_000);
    });
    expect(storage.writes).toBe(1);

    now = 2_000;
    await cache.update(() => undefined);
    await cache.update((state) => {
      // 内容相同但对象是新引用时同样应被判定为无变化。
      state.tasks = state.tasks.map((task) => ({ ...task }));
    });

    expect(storage.writes).toBe(1);
    const snapshot = await cache.getSnapshot();
    expect(snapshot.updatedAt).toBe(1_000);
    expect(snapshot.pendingUrls).toEqual(['https://a.example/']);
  });

  it('单个 update 抛错只影响自己，其他更新仍然落盘', async () => {
    const storage = new MemoryStorage();
    const cache = createHealthCacheService(storage, () => 1_000);

    const failed = cache.update(() => {
      throw new Error('mutator boom');
    });
    const succeeded = cache.update((state) => {
      upsertHealthTask(state, 'https://ok.example/', 'manual', 1_000);
    });

    await expect(failed).rejects.toThrow('mutator boom');
    await succeeded;

    const state = await cache.read();
    expect(state.tasks.map((task) => task.url)).toEqual(['https://ok.example/']);
    expect(storage.writes).toBe(1);
  });

  it('通过缓存服务保存记录并返回快照', async () => {
    const storage = new MemoryStorage();
    let now = 1_000;
    const cache = createHealthCacheService(storage, () => now);
    await cache.update((state) => {
      saveHealthRecord(state, makeRecord('https://a.example/', 'healthy', now));
      upsertHealthTask(state, 'https://b.example/', 'manual', now);
    });
    now = 2_000;

    const snapshot = await cache.getSnapshot();
    expect(snapshot.records['https://a.example/']?.status).toBe('healthy');
    expect(snapshot.pendingUrls).toEqual(['https://b.example/']);
    expect(snapshot.updatedAt).toBe(1_000);
  });

  it('schemaVersion=1 的旧数据可直接读取，不触发迁移写入', async () => {
    const storage = new MemoryStorage();
    storage.data[HEALTH_STATE_STORAGE_KEY] = {
      schemaVersion: HEALTH_SCHEMA_VERSION,
      records: { 'https://a.example/': makeRecord('https://a.example/') },
      tasks: [
        {
          url: 'https://b.example/',
          source: 'manual',
          priority: HEALTH_TASK_PRIORITY.manual,
          createdAt: 1_000,
          notBefore: 1_000,
          status: 'pending',
          recoveryCount: 0,
        },
      ],
      scan: {
        id: 'scan-1',
        mode: 'all',
        status: 'running',
        total: 2,
        completed: 1,
        startedAt: 900,
      },
      ignoredUrls: ['https://ignored.example/'],
      updatedAt: 1_000,
    };

    const cache = createHealthCacheService(storage, () => 5_000);
    const snapshot = await cache.getSnapshot();

    expect(storage.writes).toBe(0);
    expect(snapshot.schemaVersion).toBe(HEALTH_SCHEMA_VERSION);
    expect(snapshot.records['https://a.example/']?.status).toBe('healthy');
    expect(snapshot.pendingUrls).toEqual(['https://b.example/']);
    expect(snapshot.scan).toMatchObject({ id: 'scan-1', completed: 1 });
    expect(snapshot.ignoredUrls).toEqual(['https://ignored.example/']);
    expect(snapshot.updatedAt).toBe(1_000);
  });
});
