import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useWebsiteHealth } from '../src/composables/useWebsiteHealth';
import type { HealthResponse, HealthSnapshot } from '../src/types/websiteHealth';

function makeSnapshot(id: string): HealthSnapshot {
  return {
    schemaVersion: 1,
    records: {},
    pendingUrls: [],
    checkingUrls: [],
    retryUrls: [],
    ignoredUrls: [],
    scan: {
      id,
      mode: 'all',
      status: 'running',
      total: 1,
      completed: 0,
      startedAt: 1_000,
    },
    updatedAt: 1_000,
  };
}

describe('useWebsiteHealth 快照请求', () => {
  const callbacks: Array<(response: HealthResponse | undefined) => void> = [];

  afterEach(() => {
    callbacks.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('只接受最新一次快照请求的结果', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        sendMessage: (
          _message: unknown,
          callback: (response: HealthResponse | undefined) => void,
        ) => {
          callbacks.push(callback);
        },
      },
      storage: {
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });

    const health = useWebsiteHealth({ homepage: ref(null) });
    const first = health.loadSnapshot();
    const second = health.loadSnapshot();
    expect(callbacks).toHaveLength(2);

    callbacks[1]?.({ ok: true, snapshot: makeSnapshot('newer') });
    await second;
    expect(health.scan.value?.id).toBe('newer');

    callbacks[0]?.({ ok: true, snapshot: makeSnapshot('older') });
    await first;
    expect(health.scan.value?.id).toBe('newer');
    expect(health.loaded.value).toBe(true);
  });

  it('actionBusy 期间的刷新只排队一次，action 结束后补读快照', async () => {
    const snapshotCallbacks: Array<
      (response: HealthResponse | undefined) => void
    > = [];
    const actionCallbacks: Array<
      (response: HealthResponse | undefined) => void
    > = [];

    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        sendMessage: (
          message: { type: string },
          callback: (response: HealthResponse | undefined) => void,
        ) => {
          if (message.type === 'HEALTH_GET_SNAPSHOT') {
            snapshotCallbacks.push(callback);
          } else {
            actionCallbacks.push(callback);
          }
        },
      },
      storage: {
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });

    const health = useWebsiteHealth({ homepage: ref(null) });
    const action = health.checkAll();
    expect(health.actionBusy.value).toBe(true);

    // action 期间多次触发刷新（storage 变更 / 可见性 / 手动），只保留一个待办。
    await health.loadSnapshot();
    await health.loadSnapshot();
    expect(snapshotCallbacks).toHaveLength(0);

    actionCallbacks[0]?.({
      ok: true,
      snapshot: makeSnapshot('after-action'),
      notice: '已加入队列',
    });
    await action;

    expect(health.actionBusy.value).toBe(false);
    expect(snapshotCallbacks).toHaveLength(1);

    snapshotCallbacks[0]?.({ ok: true, snapshot: makeSnapshot('after-refresh') });
    await vi.waitFor(() => {
      expect(health.scan.value?.id).toBe('after-refresh');
    });
    expect(health.loading.value).toBe(false);

    // 排队标记已清理：再手动刷新才会发起新请求，不会重复补读。
    expect(snapshotCallbacks).toHaveLength(1);
    const manualRefresh = health.loadSnapshot();
    expect(snapshotCallbacks).toHaveLength(2);
    snapshotCallbacks[1]?.({ ok: true, snapshot: makeSnapshot('manual') });
    await manualRefresh;
  });
});
