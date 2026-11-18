import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBookmarks } from '../src/composables/useBookmarks';
import type { BookmarkTreeDataSource } from '../src/services/bookmarkService';
import type { NativeBookmarkNode } from '../src/types/bookmark';
import { makeStandardTree, makeTree } from './fixtures/bookmarkTree';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(tree: NativeBookmarkNode[] = makeStandardTree()) {
  const getTree = vi.fn(async () => tree);
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((_listener: () => void) => unsubscribe);
  const dataSource: BookmarkTreeDataSource = { getTree, subscribe };
  return { dataSource, getTree, subscribe, unsubscribe };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useBookmarks', () => {
  it('启动时订阅事件并读取完整书签树', async () => {
    const { dataSource, subscribe } = setup();
    const store = useBookmarks({
      dataSource,
      autoStart: false,
      now: () => 123456,
    });

    await store.start();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(store.data.value?.summary.bookmarkCount).toBe(13);
    expect(store.loading.value).toBe(false);
    expect(store.error.value).toBeNull();
    expect(store.lastUpdatedAt.value).toBe(123456);

    store.stop();
  });

  it('把连续事件合并为一次重新读取，并更新展示模型', async () => {
    vi.useFakeTimers();
    const { dataSource, getTree, subscribe } = setup();
    const store = useBookmarks({ dataSource, autoStart: false, debounceMs: 50 });

    await store.start();
    expect(getTree).toHaveBeenCalledTimes(1);

    const listener = subscribe.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf('function');

    listener?.();
    listener?.();
    listener?.();

    await vi.advanceTimersByTimeAsync(49);
    expect(getTree).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(getTree).toHaveBeenCalledTimes(2);

    store.stop();
  });

  it('慢的旧请求不能覆盖更新的书签状态', async () => {
    const { dataSource, getTree } = setup();
    const first = createDeferred<NativeBookmarkNode[]>();
    const second = createDeferred<NativeBookmarkNode[]>();
    getTree.mockReset();
    getTree.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const store = useBookmarks({ dataSource, autoStart: false });

    const startPromise = store.start();
    const refreshPromise = store.refresh();

    second.resolve(makeTree([]));
    await refreshPromise;
    expect(store.data.value?.summary.bookmarkCount).toBe(0);

    first.resolve(makeStandardTree());
    await startPromise;

    expect(store.data.value?.summary.bookmarkCount).toBe(0);
    expect(store.loading.value).toBe(false);

    store.stop();
  });

  it('读取失败时保留已有数据并显示中文错误', async () => {
    const { dataSource, getTree } = setup();
    const store = useBookmarks({ dataSource, autoStart: false });

    await store.start();
    const previousData = store.data.value;
    expect(previousData?.summary.bookmarkCount).toBe(13);
    expect(store.stale.value).toBe(false);

    getTree.mockRejectedValueOnce(new Error('Runtime unavailable'));
    await store.refresh();

    expect(store.data.value).toBe(previousData);
    expect(store.error.value).toBe('读取书签失败：Runtime unavailable');
    expect(store.stale.value).toBe(true);
    expect(store.loading.value).toBe(false);

    getTree.mockResolvedValueOnce(makeStandardTree());
    await store.refresh();
    expect(store.stale.value).toBe(false);
    expect(store.error.value).toBeNull();

    store.stop();
  });

  it('首次读取失败时没有旧数据，不标记 stale', async () => {
    const { dataSource, getTree } = setup();
    getTree.mockRejectedValueOnce(new Error('first read failed'));
    const store = useBookmarks({ dataSource, autoStart: false });

    await store.start();

    expect(store.data.value).toBeNull();
    expect(store.stale.value).toBe(false);
    expect(store.error.value).toBe('读取书签失败：first read failed');

    store.stop();
  });

  it('停止后取消事件订阅并忽略迟到的刷新事件', async () => {
    vi.useFakeTimers();
    const { dataSource, getTree, subscribe, unsubscribe } = setup();
    const store = useBookmarks({ dataSource, autoStart: false, debounceMs: 20 });

    await store.start();
    const listener = subscribe.mock.calls[0]?.[0];

    store.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    listener?.();
    await vi.advanceTimersByTimeAsync(100);

    expect(getTree).toHaveBeenCalledTimes(1);
    expect(store.loading.value).toBe(false);
  });

  it('事件订阅失败时仍读取书签，但保留明确错误提示', async () => {
    const { dataSource, subscribe } = setup();
    subscribe.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });
    const store = useBookmarks({ dataSource, autoStart: false });

    await store.start();

    expect(store.data.value?.summary.bookmarkCount).toBe(13);
    expect(store.error.value).toBe('监听书签变化失败：permission denied');
    expect(store.loading.value).toBe(false);

    store.stop();
  });

  it('写后刷新和延迟事件合并为一次完整树读取', async () => {
    vi.useFakeTimers();
    const { dataSource, getTree, subscribe } = setup();
    const store = useBookmarks({ dataSource, autoStart: false, debounceMs: 50 });

    await store.start();
    expect(getTree).toHaveBeenCalledTimes(1);
    const listener = subscribe.mock.calls[0]?.[0];

    const pending = store.refreshSoon();
    listener?.();
    listener?.();

    await vi.advanceTimersByTimeAsync(49);
    expect(getTree).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(getTree).toHaveBeenCalledTimes(2);

    store.stop();
  });

  it('没有事件时 refreshSoon 用同一窗口兜底读取', async () => {
    vi.useFakeTimers();
    const { dataSource, getTree } = setup();
    const store = useBookmarks({ dataSource, autoStart: false, debounceMs: 30 });

    await store.start();
    const pending = store.refreshSoon();
    await vi.advanceTimersByTimeAsync(30);
    await pending;

    expect(getTree).toHaveBeenCalledTimes(2);
    store.stop();
  });

  it('停止时取消待执行的合并刷新', async () => {
    vi.useFakeTimers();
    const { dataSource, getTree } = setup();
    const store = useBookmarks({ dataSource, autoStart: false, debounceMs: 50 });

    await store.start();
    const pending = store.refreshSoon();
    store.stop();
    await pending;
    await vi.advanceTimersByTimeAsync(100);

    expect(getTree).toHaveBeenCalledTimes(1);
  });

  it('再次 start 不会重复订阅', async () => {
    const { dataSource, subscribe } = setup();
    const store = useBookmarks({ dataSource, autoStart: false });

    await store.start();
    await store.start();

    expect(subscribe).toHaveBeenCalledTimes(1);
    store.stop();
  });
});
