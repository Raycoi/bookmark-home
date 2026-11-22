import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import {
  collectSelectableIds,
  findHomepageBookmark,
  findHomepageFolder,
} from '../src/utils/folders';
import { makeStandardTree } from './fixtures/bookmarkTree';
import { setupManager } from './fixtures/bookmarkManager';

describe('多选状态机', () => {
  it('进入选择模式后清空选择，退出时同样清空', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    expect(google).not.toBeNull();

    manager.enterSelection();
    expect(manager.selectionMode.value).toBe(true);

    manager.toggleSelection(google!.id);
    expect(manager.selectedIds.value.has(google!.id)).toBe(true);
    expect(manager.selectedCount.value).toBe(1);

    manager.exitSelection();
    expect(manager.selectionMode.value).toBe(false);
    expect(manager.selectedIds.value.size).toBe(0);
    expect(manager.selectedCount.value).toBe(0);
  });

  it('非选择模式下点击不改变选择', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');

    manager.toggleSelection(google!.id);
    manager.selectBookmarkIds([google!.id]);

    expect(manager.selectionMode.value).toBe(false);
    expect(manager.selectedCount.value).toBe(0);
  });

  it('单选可以再次点击取消', () => {
    const { manager, data } = setupManager();
    const google = findHomepageBookmark(data, 'bm-google');
    const youtube = findHomepageBookmark(data, 'bm-youtube');

    manager.enterSelection();
    manager.toggleSelection(google!.id);
    manager.toggleSelection(youtube!.id);
    expect([...manager.selectedIds.value]).toEqual([
      google!.id,
      youtube!.id,
    ]);

    manager.toggleSelection(google!.id);
    expect([...manager.selectedIds.value]).toEqual([youtube!.id]);
    expect(manager.selectedCount.value).toBe(1);
  });

  it('全选按展示顺序收录书签与文件夹，选中书签过滤掉文件夹', () => {
    const { manager, data } = setupManager();
    const order = collectSelectableIds(data);
    expect(order.length).toBeGreaterThan(0);

    manager.setSelectionOrder(order);
    manager.enterSelection();
    manager.selectBookmarkIds(order);

    expect(manager.selectedCount.value).toBe(order.length);
    const bookmarkIds = order.filter(
      (id) => findHomepageBookmark(data, id) !== null,
    );
    expect(manager.selectedBookmarks.value.map((bookmark) => bookmark.id)).toEqual(
      bookmarkIds,
    );
    expect(manager.selectedBookmarks.value.map((bookmark) => bookmark.id)).toContain(
      'bm-google',
    );
    expect(
      manager.selectedBookmarks.value.map((bookmark) => bookmark.id),
    ).not.toContain('folder-ai');
  });

  it('Shift 点击按展示顺序选中正向连续范围', () => {
    const { manager, data } = setupManager();
    manager.setSelectionOrder(collectSelectableIds(data));
    manager.enterSelection();

    manager.toggleSelection('bm-google');
    manager.toggleSelection('bm-github', true);

    expect([...manager.selectedIds.value]).toEqual([
      'bm-google',
      'bm-youtube',
      'bm-github',
    ]);
  });

  it('Shift 点击按展示顺序选中反向连续范围', () => {
    const { manager, data } = setupManager();
    manager.setSelectionOrder(collectSelectableIds(data));
    manager.enterSelection();

    manager.toggleSelection('bm-github');
    manager.toggleSelection('bm-google', true);

    expect([...manager.selectedIds.value]).toEqual([
      'bm-google',
      'bm-youtube',
      'bm-github',
    ]);
  });

  it('锚点不在展示顺序中时 Shift 点击退化为普通切换', () => {
    const { manager } = setupManager();
    manager.enterSelection();
    manager.toggleSelection('bm-google');
    manager.setSelectionOrder(['bm-youtube', 'bm-github']);

    manager.toggleSelection('bm-youtube', true);

    expect([...manager.selectedIds.value]).toEqual([
      'bm-google',
      'bm-youtube',
    ]);
  });

  it('选中项按当前树解析，已消失的节点被忽略', () => {
    const { manager } = setupManager();
    manager.enterSelection();

    manager.selectBookmarkIds(['missing', 'folder-ai', 'bm-google']);

    expect(manager.selectedCount.value).toBe(3);
    expect(
      manager.selectedBookmarks.value.map((bookmark) => bookmark.id),
    ).toEqual(['bm-google']);

    manager.askBulkDelete();
    expect(manager.confirmDialog.value?.bulkIds).toEqual([
      'folder-ai',
      'bm-google',
    ]);
    manager.closeConfirmDialog();
    manager.exitSelection();
  });

  it('树刷新时自动退出选择模式', async () => {
    const { manager, dataRef } = setupManager();
    manager.enterSelection();
    manager.toggleSelection('bm-google');

    dataRef.value = transformBookmarkTree(makeStandardTree());
    await nextTick();

    expect(manager.selectionMode.value).toBe(false);
    expect(manager.selectedCount.value).toBe(0);
  });

  it('忙碌时不能进入选择模式', () => {
    const { manager } = setupManager();
    manager.busy.value = true;

    manager.enterSelection();
    expect(manager.selectionMode.value).toBe(false);

    manager.busy.value = false;
    manager.enterSelection();
    expect(manager.selectionMode.value).toBe(true);
    manager.exitSelection();
  });

  it('进入选择模式会关闭当前 toast', () => {
    const { manager } = setupManager();
    manager.notify('success', '提示');

    manager.enterSelection();

    expect(manager.toast.value).toBeNull();
    manager.exitSelection();
  });

  it('文件夹与书签可以同时选中', () => {
    const { manager, data } = setupManager();
    const folder = findHomepageFolder(data, 'folder-ai');

    manager.enterSelection();
    manager.toggleSelection(folder!.id);
    manager.toggleSelection('bm-google');

    expect(manager.selectedCount.value).toBe(2);
    expect(
      manager.selectedBookmarks.value.map((bookmark) => bookmark.id),
    ).toEqual(['bm-google']);
    manager.askBulkDelete();
    expect(manager.confirmDialog.value?.bulkIds).toEqual([
      'folder-ai',
      'bm-google',
    ]);
    manager.closeConfirmDialog();
    manager.exitSelection();
  });
});
