import { afterEach, describe, expect, it, vi } from 'vitest';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import {
  findHomepageBookmark,
  findHomepageFolder,
} from '../src/utils/folders';
import { makeTree, nativeBookmark } from './fixtures/bookmarkTree';
import { setupManager } from './fixtures/bookmarkManager';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 右键菜单按元素定位只需要 getBoundingClientRect。 */
function anchorElement(): HTMLElement {
  return {
    getBoundingClientRect: () => ({ right: 120, bottom: 40 }),
  } as unknown as HTMLElement;
}

describe('右键菜单编排', () => {
  it('打开书签菜单时定位并携带目标节点', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.openBookmarkMenuAt(anchorElement(), google);

    expect(manager.contextMenu.value?.x).toBe(120);
    expect(manager.contextMenu.value?.y).toBe(46);
    expect(manager.contextMenu.value?.target).toEqual({
      kind: 'bookmark',
      node: google,
    });
    expect(manager.contextMenu.value?.items.map((item) => item.id)).toEqual([
      'open',
      'open-new',
      'edit',
      'move',
      'delete-bookmark',
    ]);

    manager.closeContextMenu();
    expect(manager.contextMenu.value).toBeNull();
  });

  it('非 http 书签的打开项被禁用', () => {
    const data = transformBookmarkTree(
      makeTree([
        nativeBookmark('bm-settings', '1', 0, '设置', 'chrome://settings/'),
      ]),
    );
    const { manager } = setupManager(data);
    const settings = findHomepageBookmark(data, 'bm-settings')!;

    manager.openBookmarkMenuAt(anchorElement(), settings);

    const items = manager.contextMenu.value!.items;
    expect(items.find((item) => item.id === 'open')?.disabled).toBe(true);
    expect(items.find((item) => item.id === 'open-new')?.disabled).toBe(true);
    expect(items.find((item) => item.id === 'edit')?.disabled).toBeUndefined();
  });

  it('受保护文件夹不提供重命名、移动和删除项', () => {
    const { manager, data } = setupManager();

    manager.openFolderMenuAt(anchorElement(), data.bookmarksBar);

    expect(manager.contextMenu.value?.items.map((item) => item.id)).toEqual([
      'add-bookmark',
      'add-subfolder',
    ]);
    expect(manager.contextMenu.value?.items[1]?.label).toBe('新建文件夹');
  });

  it('普通文件夹提供完整操作项', () => {
    const { manager, data } = setupManager();
    const ai = findHomepageFolder(data, 'folder-ai')!;

    manager.openFolderMenuAt(anchorElement(), ai);

    expect(manager.contextMenu.value?.items.map((item) => item.id)).toEqual([
      'add-bookmark',
      'add-subfolder',
      'rename-folder',
      'move',
      'delete-folder',
    ]);
    expect(manager.contextMenu.value?.items[1]?.label).toBe('新建子文件夹');
  });

  it('右键菜单在视口边缘收敛，并阻止浏览器默认菜单', () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800 });
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;
    const event = {
      clientX: 1500,
      clientY: 900,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    manager.openBookmarkContextMenu(event, google);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(manager.contextMenu.value?.x).toBe(1200 - 200 - 8);
    expect(manager.contextMenu.value?.y).toBe(800 - 260 - 8);
  });

  it('分发编辑动作会关闭菜单并打开书签编辑器', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.openBookmarkMenuAt(anchorElement(), google);
    manager.handleContextAction('edit');

    expect(manager.contextMenu.value).toBeNull();
    expect(manager.bookmarkEditor.value).toEqual({
      mode: 'edit',
      bookmark: google,
    });
    manager.closeBookmarkEditor();
  });

  it('分发移动动作会打开对应目标的移动框', () => {
    const { manager, data } = setupManager();
    const ai = findHomepageFolder(data, 'folder-ai')!;

    manager.openFolderMenuAt(anchorElement(), ai);
    manager.handleContextAction('move');

    expect(manager.moveDialog.value?.target).toEqual({
      kind: 'folder',
      node: ai,
    });
    expect(manager.moveDialog.value?.currentParentId).toBe('1');
    manager.closeMoveDialog();
  });

  it('分发删除动作会打开确认框', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.openBookmarkMenuAt(anchorElement(), google);
    manager.handleContextAction('delete-bookmark');

    expect(manager.confirmDialog.value?.target).toEqual({
      kind: 'bookmark',
      node: google,
    });
    expect(manager.confirmDialog.value?.title).toContain('Google');
    manager.closeConfirmDialog();
  });

  it('打开无效网址的书签会提示错误而不导航', () => {
    const data = transformBookmarkTree(
      makeTree([
        nativeBookmark('bm-settings', '1', 0, '设置', 'chrome://settings/'),
      ]),
    );
    const { manager } = setupManager(data);
    const settings = findHomepageBookmark(data, 'bm-settings')!;

    manager.openBookmarkMenuAt(anchorElement(), settings);
    manager.handleContextAction('open');

    expect(manager.toast.value?.tone).toBe('error');
    expect(manager.toast.value?.message).toBe('该网址格式无效，无法打开');
    manager.dismissToast();
  });

  it('没有右键菜单时忽略动作', () => {
    const { manager } = setupManager();

    manager.handleContextAction('edit');

    expect(manager.bookmarkEditor.value).toBeNull();
  });
});

describe('删除确认错误分支', () => {
  it('删除书签失败时保留确认框并记录错误', async () => {
    const { manager, service, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.askDeleteBookmark(google);
    service.removeBookmark.mockRejectedValueOnce(new Error('denied'));

    await manager.confirmDelete();

    expect(manager.dialogError.value).toContain('denied');
    expect(manager.confirmDialog.value).not.toBeNull();
    expect(manager.busy.value).toBe(false);
    expect(manager.toast.value).toBeNull();
  });

  it('删除文件夹失败时保留确认框并记录错误', async () => {
    const { manager, service, data } = setupManager();
    const ai = findHomepageFolder(data, 'folder-ai')!;

    manager.askDeleteFolder(ai);
    service.removeFolder.mockRejectedValueOnce(new Error('locked'));

    await manager.confirmDelete();

    expect(manager.dialogError.value).toContain('locked');
    expect(manager.confirmDialog.value).not.toBeNull();
    expect(manager.busy.value).toBe(false);
  });

  it('忙碌时不能打开删除确认框，也不能关闭已有确认框', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;
    manager.busy.value = true;

    manager.askDeleteBookmark(google);
    expect(manager.confirmDialog.value).toBeNull();

    manager.busy.value = false;
    manager.askDeleteBookmark(google);
    manager.busy.value = true;
    manager.closeConfirmDialog();

    expect(manager.confirmDialog.value).not.toBeNull();
    manager.busy.value = false;
  });
});

describe('移动确认错误分支', () => {
  it('目标文件夹不存在时记录错误并保留移动框', async () => {
    const { manager, service, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.openMoveDialog({ kind: 'bookmark', node: google });
    await manager.confirmMove('folder-missing');

    expect(manager.dialogError.value).toBe('目标文件夹已不存在，请重新选择');
    expect(manager.moveDialog.value).not.toBeNull();
    expect(service.moveBookmark).not.toHaveBeenCalled();
    expect(manager.busy.value).toBe(false);
  });

  it('移动 API 失败时保留移动框并记录错误', async () => {
    const { manager, service, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.openMoveDialog({ kind: 'bookmark', node: google });
    service.moveBookmark.mockRejectedValueOnce(new Error('quota exceeded'));

    await manager.confirmMove('folder-dev');

    expect(manager.dialogError.value).toContain('quota exceeded');
    expect(manager.moveDialog.value).not.toBeNull();
    expect(manager.busy.value).toBe(false);
  });

  it('数据为空或忙碌时不打开移动框', () => {
    const { manager, data, dataRef } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.busy.value = true;
    manager.openMoveDialog({ kind: 'bookmark', node: google });
    expect(manager.moveDialog.value).toBeNull();
    manager.busy.value = false;

    dataRef.value = null;
    manager.openMoveDialog({ kind: 'bookmark', node: google });
    expect(manager.moveDialog.value).toBeNull();
  });

  it('忙碌时不能关闭移动框', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google')!;

    manager.openMoveDialog({ kind: 'bookmark', node: google });
    manager.busy.value = true;
    manager.closeMoveDialog();

    expect(manager.moveDialog.value).not.toBeNull();
    manager.busy.value = false;
  });
});
