import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRenderer,
  h,
  type RendererOptions,
} from 'vue';
import { useSearch } from '../src/composables/useSearch';
import { SEARCH_ENGINE_STORAGE_KEY } from '../src/services/settingsService';

interface HostNode {
  id: number;
}

// 测试环境是 node，没有 DOM；用一个最小宿主渲染器挂载组件，
// 以便触发 useSearch 的 onMounted / onUnmounted（读取偏好、注册 storage 监听）。
const nodeOps: RendererOptions<HostNode, HostNode> = {
  patchProp: () => undefined,
  insert: () => undefined,
  remove: () => undefined,
  createElement: () => ({ id: 0 }),
  createText: () => ({ id: 0 }),
  createComment: () => ({ id: 0 }),
  setText: () => undefined,
  setElementText: () => undefined,
  parentNode: () => null,
  nextSibling: () => null,
};

interface MountedSearch {
  search: ReturnType<typeof useSearch>;
  unmount: () => void;
}

function mountSearch(): MountedSearch {
  const { createApp } = createRenderer<HostNode, HostNode>(nodeOps);
  const holder: { search?: ReturnType<typeof useSearch> } = {};
  const app = createApp({
    setup() {
      holder.search = useSearch();
      return () => h('div');
    },
  });
  app.mount({ id: 0 });

  const search = holder.search;
  if (!search) {
    throw new Error('useSearch 未初始化');
  }
  return { search, unmount: () => app.unmount() };
}

interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

type StorageListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

interface ChromeStubOptions {
  get: (key: string) => Promise<Record<string, unknown>>;
  set?: (items: Record<string, unknown>) => Promise<void>;
}

function stubChrome(options: ChromeStubOptions) {
  const listeners: StorageListener[] = [];
  const addListener = vi.fn((listener: StorageListener) => {
    listeners.push(listener);
  });
  const removeListener = vi.fn((listener: StorageListener) => {
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  });
  const get = vi.fn(options.get);
  const set = vi.fn(options.set ?? (async () => undefined));

  vi.stubGlobal('chrome', {
    storage: {
      sync: { get, set },
      onChanged: { addListener, removeListener },
    },
  });

  return { get, set, addListener, removeListener, listeners };
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSearch 搜索引擎偏好', () => {
  it('挂载时读取已存偏好，并响应 sync storage 变更', async () => {
    const { listeners, removeListener } = stubChrome({
      get: async () => ({ [SEARCH_ENGINE_STORAGE_KEY]: 'baidu' }),
    });
    const { search, unmount } = mountSearch();

    expect(search.selectedEngineId.value).toBe('google');
    await flushAsyncWork();
    expect(search.selectedEngineId.value).toBe('baidu');
    expect(search.currentEngine.value.id).toBe('baidu');

    const listener = listeners[0];
    expect(listener).toBeTypeOf('function');

    listener?.(
      { [SEARCH_ENGINE_STORAGE_KEY]: { newValue: 'bing' } },
      'sync',
    );
    expect(search.selectedEngineId.value).toBe('bing');
    expect(search.currentEngine.value.id).toBe('bing');

    // 其它 storage 区域与非法值都会被忽略。
    listener?.(
      { [SEARCH_ENGINE_STORAGE_KEY]: { newValue: 'duckduckgo' } },
      'local',
    );
    expect(search.selectedEngineId.value).toBe('bing');

    listener?.(
      { [SEARCH_ENGINE_STORAGE_KEY]: { newValue: 'not-an-engine' } },
      'sync',
    );
    expect(search.selectedEngineId.value).toBe('bing');

    unmount();
    expect(removeListener).toHaveBeenCalledWith(listener);
    expect(listeners).toHaveLength(0);
  });

  it('手动切换会持久化，且旧 sync 值不会覆盖用户选择', async () => {
    let resolveStored!: (value: Record<string, unknown>) => void;
    const pending = new Promise<Record<string, unknown>>((resolve) => {
      resolveStored = resolve;
    });
    const { set } = stubChrome({ get: () => pending });
    const { search, unmount } = mountSearch();

    search.setSearchEngine('bing');
    expect(search.selectedEngineId.value).toBe('bing');
    expect(set).toHaveBeenCalledWith({ [SEARCH_ENGINE_STORAGE_KEY]: 'bing' });

    // 异步读取此刻才返回旧偏好，不能覆盖用户已经做出的选择。
    resolveStored({ [SEARCH_ENGINE_STORAGE_KEY]: 'baidu' });
    await flushAsyncWork();
    expect(search.selectedEngineId.value).toBe('bing');
    expect(search.currentEngine.value.id).toBe('bing');

    // 与当前值相同的切换不再重复写入。
    search.setSearchEngine('bing');
    expect(set).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('非法或重复选择不会改变当前引擎', async () => {
    const { set } = stubChrome({
      get: async () => ({}),
    });
    const { search, unmount } = mountSearch();
    await flushAsyncWork();
    expect(search.selectedEngineId.value).toBe('google');

    search.setSearchEngine('not-an-engine');
    search.setSearchEngine('google');
    expect(search.selectedEngineId.value).toBe('google');
    expect(set).not.toHaveBeenCalled();

    unmount();
  });
});
