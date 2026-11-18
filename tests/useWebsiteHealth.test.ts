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
});
