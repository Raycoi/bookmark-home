import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import {
  findHomepageBookmark,
  findHomepageFolder,
} from '../src/utils/folders';
import {
  makeTree,
  nativeBookmark,
  nativeFolder,
} from './fixtures/bookmarkTree';
import { setupManager } from './fixtures/bookmarkManager';

class FakeElement {
  constructor(
    private readonly rect: { left: number; width: number } = {
      left: 0,
      width: 0,
    },
  ) {}

  getBoundingClientRect(): DOMRect {
    return {
      left: this.rect.left,
      top: 0,
      right: this.rect.left + this.rect.width,
      bottom: 0,
      width: this.rect.width,
      height: 0,
      x: this.rect.left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  contains(): boolean {
    return false;
  }
}

function createDataTransfer() {
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
  };
}

interface FakeDragInit {
  dataTransfer?: ReturnType<typeof createDataTransfer> | null;
  currentTarget?: FakeElement | null;
  relatedTarget?: FakeElement | null;
  clientX?: number;
}

function createDragEvent(init: FakeDragInit = {}) {
  const event = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: init.dataTransfer ?? null,
    currentTarget: init.currentTarget ?? null,
    relatedTarget: init.relatedTarget ?? null,
    clientX: init.clientX ?? 0,
  };
  return { event, dragEvent: event as unknown as DragEvent };
}

function createMouseEvent() {
  const event = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return { event, mouseEvent: event as unknown as MouseEvent };
}

function nestedData() {
  return transformBookmarkTree(
    makeTree([
      nativeFolder('outer', '1', 0, '外层', [
        nativeFolder('inner', 'outer', 0, '内层'),
        nativeBookmark(
          'inner-bm',
          'outer',
          1,
          '内部书签',
          'https://inner.example/',
        ),
      ]),
      nativeFolder('target', '1', 1, '目标'),
    ]),
  );
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('Node', FakeElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('拖拽状态机', () => {
  it('开始拖拽记录节点、写入 dataTransfer 并关闭菜单', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const dataTransfer = createDataTransfer();
    const { dragEvent } = createDragEvent({ dataTransfer });

    manager.openBookmarkMenuAt(
      new FakeElement() as unknown as HTMLElement,
      google!,
    );
    expect(manager.contextMenu.value).not.toBeNull();

    manager.startDrag(dragEvent, { kind: 'bookmark', node: google! });

    expect(manager.contextMenu.value).toBeNull();
    expect(manager.dragState.value?.node.node.id).toBe('bm-google');
    expect(manager.dragState.value?.drop).toBeNull();
    expect(manager.isDraggingNode('bm-google')).toBe(true);
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-bookmark-home-node',
      JSON.stringify({ id: 'bm-google', kind: 'bookmark' }),
    );
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'Google');

    manager.endDrag();
  });

  it('受保护的系统节点不允许拖起', () => {
    const { manager, data } = setupManager();
    const { event, dragEvent } = createDragEvent();

    manager.startDrag(dragEvent, {
      kind: 'folder',
      node: data.bookmarksBar,
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(manager.dragState.value).toBeNull();
  });

  it('忙碌时不允许开始拖拽', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const { event, dragEvent } = createDragEvent();
    manager.busy.value = true;

    manager.startDrag(dragEvent, { kind: 'bookmark', node: google! });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(manager.dragState.value).toBeNull();
    manager.busy.value = false;
  });

  it('不能把节点拖到自己身上', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });

    const over = createDragEvent({ currentTarget: new FakeElement() });
    expect(manager.dragOverBookmark(over.dragEvent, google!)).toBe(false);

    expect(over.event.preventDefault).not.toHaveBeenCalled();
    expect(manager.dragState.value?.drop).toBeNull();
    manager.endDrag();
  });

  it('悬停其他书签时按水平位置计算 before/after', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const youtube = findHomepageBookmark(data, 'bm-youtube');
    const github = findHomepageBookmark(data, 'bm-github');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });

    const after = createDragEvent({
      currentTarget: new FakeElement({ left: 0, width: 100 }),
      clientX: 80,
    });
    expect(manager.dragOverBookmark(after.dragEvent, youtube!)).toBe(true);
    expect(after.event.preventDefault).toHaveBeenCalled();
    expect(after.event.stopPropagation).toHaveBeenCalled();
    expect(manager.dragState.value?.drop).toEqual({
      kind: 'bookmark',
      id: 'bm-youtube',
      parentId: '1',
      position: 'after',
    });
    expect(manager.isBookmarkDropAfter('bm-youtube')).toBe(true);
    expect(manager.isBookmarkDropBefore('bm-youtube')).toBe(false);

    const before = createDragEvent({
      currentTarget: new FakeElement({ left: 0, width: 100 }),
      clientX: 20,
    });
    expect(manager.dragOverBookmark(before.dragEvent, github!)).toBe(true);
    expect(manager.isBookmarkDropBefore('bm-github')).toBe(true);
    manager.endDrag();
  });

  it('拒绝拖入自身子树，允许拖入无关文件夹', () => {
    const data = nestedData();
    const { manager } = setupManager(data);
    const outer = findHomepageFolder(data, 'outer');
    const inner = findHomepageFolder(data, 'inner');
    const target = findHomepageFolder(data, 'target');
    const innerBookmark = findHomepageBookmark(data, 'inner-bm');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'folder', node: outer! });

    const overInner = createDragEvent({ currentTarget: new FakeElement() });
    expect(manager.dragOverFolder(overInner.dragEvent, inner!)).toBe(false);
    expect(overInner.event.preventDefault).not.toHaveBeenCalled();

    const overOwn = createDragEvent({ currentTarget: new FakeElement() });
    expect(manager.dragOverFolder(overOwn.dragEvent, outer!)).toBe(false);

    const overChildBookmark = createDragEvent({
      currentTarget: new FakeElement(),
    });
    expect(
      manager.dragOverBookmark(overChildBookmark.dragEvent, innerBookmark!),
    ).toBe(false);
    expect(manager.dragState.value?.drop).toBeNull();

    const overTarget = createDragEvent({ currentTarget: new FakeElement() });
    expect(manager.dragOverFolder(overTarget.dragEvent, target!)).toBe(true);
    expect(manager.dragState.value?.drop).toEqual({
      kind: 'folder',
      id: 'target',
      parentId: 'target',
      position: 'inside',
    });
    expect(manager.isFolderDropTarget('target')).toBe(true);
    manager.endDrag();
  });

  it('drop 书签时按计算后的 index 调用 moveBookmark', async () => {
    const { manager, service, refresh, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const youtube = findHomepageBookmark(data, 'bm-youtube');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });

    const drop = createDragEvent({
      currentTarget: new FakeElement({ left: 0, width: 100 }),
      clientX: 80,
    });
    manager.dropOnBookmark(drop.dragEvent, youtube!);
    await flushAsync();

    expect(service.moveBookmark).toHaveBeenCalledTimes(1);
    expect(service.moveBookmark).toHaveBeenCalledWith('bm-google', {
      parentId: '1',
      index: 1,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(manager.dragState.value).toBeNull();
    expect(manager.busy.value).toBe(false);
    expect(manager.toast.value?.message).toBe('已调整顺序');
    manager.dismissToast();
  });

  it('drop 到文件夹时追加到目标文件夹末尾', async () => {
    const { manager, service, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const dev = findHomepageFolder(data, 'folder-dev');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });

    const drop = createDragEvent();
    manager.dropOnFolder(drop.dragEvent, dev!);
    await flushAsync();

    expect(service.moveBookmark).toHaveBeenCalledTimes(1);
    expect(service.moveBookmark).toHaveBeenCalledWith('bm-google', {
      parentId: 'folder-dev',
      index: 2,
    });
    expect(manager.toast.value?.message).toBe('已移动书签');
    manager.dismissToast();
  });

  it('同父级且位置不变时不发起移动', async () => {
    const { manager, service, refresh, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const youtube = findHomepageBookmark(data, 'bm-youtube');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });

    const drop = createDragEvent({
      currentTarget: new FakeElement({ left: 0, width: 100 }),
      clientX: 20,
    });
    manager.dropOnBookmark(drop.dragEvent, youtube!);
    await flushAsync();

    expect(service.moveBookmark).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(manager.dragState.value).toBeNull();
  });

  it('目标书签消失导致无法计算位置时提示错误且不移动', async () => {
    const { manager, service, dataRef, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const youtube = findHomepageBookmark(data, 'bm-youtube');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });

    const firstHover = createDragEvent({
      currentTarget: new FakeElement({ left: 0, width: 100 }),
      clientX: 80,
    });
    expect(manager.dragOverBookmark(firstHover.dragEvent, youtube!)).toBe(true);

    dataRef.value = transformBookmarkTree(
      makeTree([
        nativeBookmark('bm-google', '1', 0, 'Google', 'https://www.google.com/'),
      ]),
    );

    const drop = createDragEvent({
      currentTarget: new FakeElement({ left: 0, width: 100 }),
      clientX: 80,
    });
    manager.dropOnBookmark(drop.dragEvent, youtube!);
    await flushAsync();

    expect(service.moveBookmark).not.toHaveBeenCalled();
    expect(manager.toast.value?.message).toBe('无法确定插入位置，移动未执行');
    expect(manager.dragState.value).toBeNull();
    manager.dismissToast();
  });

  it('拖拽离开目标时清除落点', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const youtube = findHomepageBookmark(data, 'bm-youtube');
    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });

    const over = createDragEvent({ currentTarget: new FakeElement() });
    manager.dragOverBookmark(over.dragEvent, youtube!);
    expect(manager.dragState.value?.drop).not.toBeNull();

    const otherLeave = createDragEvent();
    manager.dragLeaveBookmark(otherLeave.dragEvent, 'bm-github');
    expect(manager.dragState.value?.drop).not.toBeNull();

    const leave = createDragEvent();
    manager.dragLeaveBookmark(leave.dragEvent, 'bm-youtube');
    expect(manager.dragState.value?.drop).toBeNull();
    manager.endDrag();
  });

  it('拖拽结束后抑制紧随其后的点击，超时后恢复', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');

    const idleClick = createMouseEvent();
    expect(manager.shouldSuppressClick(idleClick.mouseEvent)).toBe(false);
    expect(idleClick.event.preventDefault).not.toHaveBeenCalled();

    const start = createDragEvent();
    manager.startDrag(start.dragEvent, { kind: 'bookmark', node: google! });
    const duringDragClick = createMouseEvent();
    expect(manager.shouldSuppressClick(duringDragClick.mouseEvent)).toBe(true);
    expect(duringDragClick.event.preventDefault).toHaveBeenCalled();

    now.mockReturnValue(1_601);
    const expiredClick = createMouseEvent();
    expect(manager.shouldSuppressClick(expiredClick.mouseEvent)).toBe(false);
    expect(expiredClick.event.preventDefault).not.toHaveBeenCalled();

    manager.endDrag();
    expect(manager.dragState.value).toBeNull();
    expect(manager.isDraggingNode('bm-google')).toBe(false);

    const afterDragClick = createMouseEvent();
    expect(manager.shouldSuppressClick(afterDragClick.mouseEvent)).toBe(true);
    expect(afterDragClick.event.stopPropagation).toHaveBeenCalled();

    now.mockReturnValue(1_900);
    const settledClick = createMouseEvent();
    expect(manager.shouldSuppressClick(settledClick.mouseEvent)).toBe(false);
  });
});
