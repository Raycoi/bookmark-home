import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readSearchEnginePreference,
  saveSearchEnginePreference,
} from '../src/services/settingsService';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('settingsService', () => {
  it('没有扩展存储时回退默认搜索引擎', async () => {
    await expect(readSearchEnginePreference()).resolves.toBe('google');
    await expect(saveSearchEnginePreference('bing')).resolves.toBeUndefined();
  });

  it('读取并校验已保存的搜索引擎偏好', async () => {
    const get = vi.fn().mockResolvedValue({ 'bookmarkHome.searchEngineId': 'baidu' });
    vi.stubGlobal('chrome', { storage: { sync: { get, set: vi.fn() } } });

    await expect(readSearchEnginePreference()).resolves.toBe('baidu');
    expect(get).toHaveBeenCalledWith('bookmarkHome.searchEngineId');
  });

  it('非法或未知偏好回退默认值', async () => {
    const get = vi.fn().mockResolvedValue({ 'bookmarkHome.searchEngineId': 'unknown' });
    vi.stubGlobal('chrome', { storage: { sync: { get, set: vi.fn() } } });

    await expect(readSearchEnginePreference()).resolves.toBe('google');
  });

  it('保存时只写入搜索引擎偏好字段', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { sync: { get: vi.fn(), set } } });

    await saveSearchEnginePreference('duckduckgo');

    expect(set).toHaveBeenCalledWith({ 'bookmarkHome.searchEngineId': 'duckduckgo' });
  });

  it('存储失败不阻断页面，只记录警告', async () => {
    const get = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const set = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('chrome', { storage: { sync: { get, set } } });

    await expect(readSearchEnginePreference()).resolves.toBe('google');
    await expect(saveSearchEnginePreference('bing')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
