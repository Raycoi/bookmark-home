import { describe, expect, it } from 'vitest';
import { HEALTH_NEXT_CHECK_MS } from '../src/config/healthPolicy';
import {
  createHealthRecord,
  defaultHealthErrorMessage,
  getNextCheckAt,
  healthStatusLabel,
  healthStatusTone,
  isAbnormalHealthStatus,
  isHealthRecordStale,
  isHealthyHealthStatus,
  isStoredHealthStatus,
  mapHttpStatus,
} from '../src/utils/healthStatus';

describe('HTTP 状态分类', () => {
  it.each([
    [200, 'healthy'],
    [204, 'healthy'],
    [206, 'healthy'],
    [301, 'redirected'],
    [302, 'redirected'],
    [307, 'redirected'],
    [401, 'restricted'],
    [403, 'restricted'],
    [404, 'not_found'],
    [410, 'gone'],
    [500, 'server_error'],
    [502, 'server_error'],
    [503, 'server_error'],
    [400, 'unknown'],
    [429, 'restricted'],
  ] as const)('HTTP %i -> %s', (httpStatus, expected) => {
    expect(mapHttpStatus(httpStatus, false)).toBe(expected);
  });

  it('跳转后最终 2xx 显示已跳转', () => {
    expect(mapHttpStatus(200, true)).toBe('redirected');
  });

  it('区分正常/异常/无法确认', () => {
    expect(isHealthyHealthStatus('healthy')).toBe(true);
    expect(isHealthyHealthStatus('redirected')).toBe(true);
    expect(isAbnormalHealthStatus('not_found')).toBe(true);
    expect(isAbnormalHealthStatus('restricted')).toBe(true);
    expect(isAbnormalHealthStatus('unknown')).toBe(false);
    expect(isAbnormalHealthStatus('pending')).toBe(false);
  });

  it('只接受会持久化的状态', () => {
    expect(isStoredHealthStatus('healthy')).toBe(true);
    expect(isStoredHealthStatus('pending')).toBe(false);
    expect(isStoredHealthStatus('checking')).toBe(false);
    expect(isStoredHealthStatus('unsupported')).toBe(false);
  });
});

describe('健康状态展示', () => {
  it('提供中文标签和色调', () => {
    expect(healthStatusLabel('not_found')).toBe('页面不存在');
    expect(healthStatusLabel('unsupported')).toBe('无法检测');
    expect(healthStatusLabel('private')).toBe('内网地址');
    expect(healthStatusTone('healthy')).toBe('ok');
    expect(healthStatusTone('server_error')).toBe('error');
    expect(healthStatusTone('unknown')).toBe('warn');
    expect(healthStatusTone('private')).toBe('neutral');
    expect(healthStatusTone('pending')).toBe('neutral');
  });

  it('按状态生成下次检测时间', () => {
    const now = 1_700_000_000_000;
    expect(getNextCheckAt('healthy', now)).toBe(now + HEALTH_NEXT_CHECK_MS.healthy);
    expect(getNextCheckAt('not_found', now)).toBe(now + 24 * 60 * 60 * 1000);
    expect(getNextCheckAt('server_error', now)).toBe(now + 6 * 60 * 60 * 1000);
  });

  it('生成记录时保留 HTTP/最终 URL/错误并计算过期时间', () => {
    const now = 1_700_000_000_000;
    const record = createHealthRecord(
      'https://example.com/',
      {
        status: 'redirected',
        httpStatus: 200,
        finalUrl: 'https://www.example.com/',
        responseTime: 87,
        method: 'HEAD',
        retryCount: 1,
      },
      now,
    );

    expect(record).toMatchObject({
      url: 'https://example.com/',
      status: 'redirected',
      httpStatus: 200,
      finalUrl: 'https://www.example.com/',
      checkedAt: now,
      responseTime: 87,
      method: 'HEAD',
      retryCount: 1,
    });
    expect(record.nextCheckAt).toBe(now + 7 * 24 * 60 * 60 * 1000);
  });

  it('判断缓存是否过期', () => {
    const now = 1_000;
    expect(isHealthRecordStale({ nextCheckAt: 999 } as never, now)).toBe(true);
    expect(isHealthRecordStale({ nextCheckAt: 1_001 } as never, now)).toBe(false);
  });

  it('网络失败不显示为网站失效', () => {
    expect(defaultHealthErrorMessage('unknown')).toContain('无法确认');
    expect(defaultHealthErrorMessage('unknown', 400)).toContain('HTTP 400');
    expect(defaultHealthErrorMessage('unknown', 400)).not.toContain('网络连接异常');
    expect(defaultHealthErrorMessage('restricted', 429)).toContain('HTTP 429');
    expect(defaultHealthErrorMessage('not_found', 404)).toContain('404');
  });
});
