import { describe, expect, it, vi } from 'vitest';
import {
  HEALTH_ALARM_CLEANUP,
  HEALTH_ALARM_MAINTENANCE,
  HEALTH_ALARM_TICK,
} from '../src/config/healthPolicy';
import {
  ensureHealthAlarms,
  scheduleHealthCleanup,
  type HealthAlarmsApi,
} from '../src/services/healthAlarmService';
import {
  handleHealthRequest,
  isHealthRequest,
  type HealthMessageScheduler,
} from '../src/services/healthMessages';
import type { HealthSnapshot } from '../src/types/websiteHealth';

class MemoryAlarms implements HealthAlarmsApi {
  alarms = new Map<string, chrome.alarms.AlarmCreateInfo>();

  async get(name: string): Promise<{ name: string } | undefined> {
    return this.alarms.has(name) ? { name } : undefined;
  }

  async create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void> {
    this.alarms.set(name, info);
  }
}

function snapshot(): HealthSnapshot {
  return {
    schemaVersion: 1,
    records: {},
    pendingUrls: [],
    checkingUrls: [],
    retryUrls: [],
    ignoredUrls: [],
    scan: null,
    updatedAt: 1_000,
  };
}

function makeScheduler() {
  return {
    startScan: vi.fn(async () => ({ started: true, total: 3 })),
    cancelScan: vi.fn(async () => snapshot()),
    recheck: vi.fn(async () => true),
    ignoreUrl: vi.fn(async () => true),
    unignoreUrl: vi.fn(async () => true),
    getSnapshot: vi.fn(async () => snapshot()),
  } satisfies HealthMessageScheduler;
}

describe('alarms 注册', () => {
  it('缺失时注册 tick 和 maintenance，已存在时不重复注册', async () => {
    const alarms = new MemoryAlarms();
    const first = await ensureHealthAlarms(alarms);
    expect(first.created).toEqual([HEALTH_ALARM_TICK, HEALTH_ALARM_MAINTENANCE]);
    expect(alarms.alarms.get(HEALTH_ALARM_TICK)?.periodInMinutes).toBe(1);
    expect(alarms.alarms.get(HEALTH_ALARM_MAINTENANCE)?.periodInMinutes).toBe(360);

    const second = await ensureHealthAlarms(alarms);
    expect(second.created).toEqual([]);
  });

  it('书签删除/URL 修改后可注册一次性清理 alarm', async () => {
    const alarms = new MemoryAlarms();
    await scheduleHealthCleanup(alarms);
    expect(alarms.alarms.get(HEALTH_ALARM_CLEANUP)?.delayInMinutes).toBe(1);
  });
});

describe('健康检查消息路由', () => {
  it('识别健康检查消息', () => {
    expect(isHealthRequest({ type: 'HEALTH_GET_SNAPSHOT' })).toBe(true);
    expect(isHealthRequest({ type: 'HEALTH_RECHECK_URL', url: 'https://a/' })).toBe(true);
    expect(isHealthRequest({ type: 'OTHER' })).toBe(false);
    expect(isHealthRequest(null)).toBe(false);
  });

  it('GET 快照只读缓存，不触发扫描/重检/取消', async () => {
    const scheduler = makeScheduler();
    const response = await handleHealthRequest(
      { type: 'HEALTH_GET_SNAPSHOT' },
      scheduler,
    );

    expect(response.ok).toBe(true);
    expect(response.snapshot).toBeDefined();
    expect(scheduler.getSnapshot).toHaveBeenCalledTimes(1);
    expect(scheduler.startScan).not.toHaveBeenCalled();
    expect(scheduler.recheck).not.toHaveBeenCalled();
    expect(scheduler.cancelScan).not.toHaveBeenCalled();
  });

  it('全量/异常检测调用对应扫描模式', async () => {
    const scheduler = makeScheduler();
    await handleHealthRequest({ type: 'HEALTH_CHECK_ALL' }, scheduler);
    expect(scheduler.startScan).toHaveBeenCalledWith('all');

    await handleHealthRequest({ type: 'HEALTH_CHECK_ABNORMAL' }, scheduler);
    expect(scheduler.startScan).toHaveBeenCalledWith('abnormal');
  });

  it('单 URL 重检会校验 URL 并返回最新快照', async () => {
    const scheduler = makeScheduler();
    const response = await handleHealthRequest(
      { type: 'HEALTH_RECHECK_URL', url: 'https://example.com/' },
      scheduler,
    );
    expect(scheduler.recheck).toHaveBeenCalledWith('https://example.com/');
    expect(response.ok).toBe(true);

    const missing = await handleHealthRequest(
      { type: 'HEALTH_RECHECK_URL', url: '  ' },
      scheduler,
    );
    expect(missing.ok).toBe(false);
    expect(scheduler.recheck).toHaveBeenCalledTimes(1);
  });

  it('取消扫描返回新快照', async () => {
    const scheduler = makeScheduler();
    const response = await handleHealthRequest(
      { type: 'HEALTH_CANCEL_SCAN' },
      scheduler,
    );
    expect(scheduler.cancelScan).toHaveBeenCalledTimes(1);
    expect(response.ok).toBe(true);
  });

  it('后台异常会变成可展示错误，不抛出到消息通道', async () => {
    const scheduler = makeScheduler();
    scheduler.getSnapshot.mockRejectedValueOnce(new Error('cache unavailable'));
    const response = await handleHealthRequest(
      { type: 'HEALTH_GET_SNAPSHOT' },
      scheduler,
    );
    expect(response).toEqual({ ok: false, error: 'cache unavailable' });
  });
});
