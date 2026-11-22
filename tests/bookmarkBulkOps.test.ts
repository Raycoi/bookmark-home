import { describe, expect, it } from 'vitest';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import {
  findHomepageBookmark,
  flattenFolderOptions,
} from '../src/utils/folders';
import {
  makeTree,
  nativeBookmark,
  nativeFolder,
} from './fixtures/bookmarkTree';
import { setupManager } from './fixtures/bookmarkManager';

async function waitForToastAction(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('批量删除快照与撤销', () => {
  it('批量删除生成书签和文件夹快照，撤销时按原父级重建', async () => {
    const { manager, service, refresh } = setupManager();
    manager.enterSelection();
    manager.selectBookmarkIds(['bm-google', 'folder-fun']);

    manager.askBulkDelete();

    expect(manager.confirmDialog.value?.bulkIds).toEqual([
      'bm-google',
      'folder-fun',
    ]);
    expect(manager.confirmDialog.value?.title).toContain('2');

    await manager.confirmDelete();

    expect(service.removeBookmark).toHaveBeenCalledTimes(1);
    expect(service.removeBookmark).toHaveBeenCalledWith('bm-google');
    expect(service.removeFolder).toHaveBeenCalledTimes(1);
    expect(service.removeFolder).toHaveBeenCalledWith('folder-fun');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(manager.confirmDialog.value).toBeNull();
    expect(manager.selectionMode.value).toBe(false);
    expect(manager.toast.value?.message).toBe('已删除 2 项');
    expect(manager.toast.value?.actionLabel).toBe('撤销');
    expect(manager.busy.value).toBe(false);

    manager.runToastAction();
    await waitForToastAction();

    expect(service.createBookmark).toHaveBeenCalledWith({
      parentId: '1',
      title: 'Google',
      url: 'https://www.google.com/',
      index: 0,
    });
    expect(service.createFolder).toHaveBeenCalledWith({
      parentId: '1',
      title: '娱乐',
      index: 5,
    });
    expect(service.createBookmark).toHaveBeenCalledWith({
      parentId: 'created',
      title: 'Bilibili',
      url: 'https://www.bilibili.com/',
      index: 0,
    });
    expect(service.createBookmark).toHaveBeenCalledWith({
      parentId: 'created',
      title: 'Steam',
      url: 'https://store.steampowered.com/',
      index: 1,
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(manager.busy.value).toBe(false);
    expect(manager.toast.value?.message).toBe('已撤销批量删除');
    manager.dismissToast();
  });

  it('批量删除忽略被选中文件夹包含的子文件夹，避免重复删除', async () => {
    const data = transformBookmarkTree(
      makeTree([
        nativeFolder('outer', '1', 0, '外层', [
          nativeFolder('inner', 'outer', 0, '内层'),
        ]),
        nativeFolder('target', '1', 1, '目标'),
      ]),
    );
    const { manager, service } = setupManager(data);
    manager.enterSelection();
    manager.selectBookmarkIds(['outer', 'inner', 'target']);

    manager.askBulkDelete();

    expect(manager.confirmDialog.value?.bulkIds).toEqual([
      'outer',
      'target',
    ]);

    await manager.confirmDelete();

    expect(service.removeFolder).toHaveBeenCalledTimes(2);
    expect(service.removeFolder).toHaveBeenCalledWith('outer');
    expect(service.removeFolder).not.toHaveBeenCalledWith('inner');
    expect(service.removeFolder).toHaveBeenCalledWith('target');
    manager.dismissToast();
  });

  it('没有选中项时不打开批量删除确认', () => {
    const { manager } = setupManager();
    manager.enterSelection();

    manager.askBulkDelete();

    expect(manager.confirmDialog.value).toBeNull();
  });

  it('忙碌时批量删除不打开确认弹窗', () => {
    const { manager } = setupManager();
    manager.enterSelection();
    manager.selectBookmarkIds(['bm-google']);
    manager.busy.value = true;

    manager.askBulkDelete();

    expect(manager.confirmDialog.value).toBeNull();
    manager.busy.value = false;
  });

  it('批量删除失败时保留确认弹窗并记录错误', async () => {
    const { manager, service } = setupManager();
    manager.enterSelection();
    manager.selectBookmarkIds(['bm-google']);
    manager.askBulkDelete();
    service.removeBookmark.mockRejectedValueOnce(new Error('denied'));

    await manager.confirmDelete();

    expect(manager.dialogError.value).toContain('denied');
    expect(manager.confirmDialog.value).not.toBeNull();
    expect(manager.selectionMode.value).toBe(true);
    expect(manager.busy.value).toBe(false);
    expect(manager.toast.value).toBeNull();
  });
});

describe('批量移动', () => {
  it('批量移动逐个调用移动 API，目标为所选文件夹', async () => {
    const { manager, service, refresh } = setupManager();
    manager.enterSelection();
    manager.selectBookmarkIds(['bm-google', 'folder-fun']);

    manager.openBulkMoveDialog();

    expect(manager.moveDialog.value?.bulkIds).toEqual([
      'bm-google',
      'folder-fun',
    ]);
    expect(manager.moveDialog.value?.currentParentId).toBe('1');

    await manager.confirmMove('folder-dev');

    expect(service.moveBookmark).toHaveBeenCalledTimes(1);
    expect(service.moveBookmark).toHaveBeenCalledWith('bm-google', {
      parentId: 'folder-dev',
    });
    expect(service.moveFolder).toHaveBeenCalledTimes(1);
    expect(service.moveFolder).toHaveBeenCalledWith('folder-fun', {
      parentId: 'folder-dev',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(manager.moveDialog.value).toBeNull();
    expect(manager.selectionMode.value).toBe(false);
    expect(manager.toast.value?.message).toBe('已移动 2 项');
    expect(manager.busy.value).toBe(false);
    manager.dismissToast();
  });

  it('批量移动目标树排除所选文件夹的整个子树', () => {
    const data = transformBookmarkTree(
      makeTree([
        nativeFolder('outer', '1', 0, '外层', [
          nativeFolder('inner', 'outer', 0, '内层'),
        ]),
        nativeFolder('target', '1', 1, '目标'),
      ]),
    );
    const { manager } = setupManager(data);
    manager.enterSelection();
    manager.selectBookmarkIds(['outer']);

    manager.openBulkMoveDialog();

    const ids = flattenFolderOptions(manager.moveDialog.value!.tree).map(
      (option) => option.id,
    );
    expect(ids).not.toContain('outer');
    expect(ids).not.toContain('inner');
    expect(ids).toContain('target');
    expect(ids).toContain('2');
  });

  it('没有选中项时不打开批量移动弹窗', () => {
    const { manager } = setupManager();
    manager.enterSelection();

    manager.openBulkMoveDialog();

    expect(manager.moveDialog.value).toBeNull();
  });

  it('批量移动失败时保留弹窗并记录错误', async () => {
    const { manager, service } = setupManager();
    manager.enterSelection();
    manager.selectBookmarkIds(['bm-google']);
    manager.openBulkMoveDialog();
    service.moveBookmark.mockRejectedValueOnce(new Error('quota exceeded'));

    await manager.confirmMove('folder-dev');

    expect(manager.dialogError.value).toContain('quota exceeded');
    expect(manager.moveDialog.value).not.toBeNull();
    expect(manager.selectionMode.value).toBe(true);
    expect(manager.busy.value).toBe(false);
  });
});

describe('单条删除撤销', () => {
  it('原父文件夹已不存在时撤销恢复到其他书签', async () => {
    const { manager, service, data, dataRef } = setupManager();
    const bookmark = findHomepageBookmark(data, 'bm-github-dev');
    expect(bookmark).not.toBeNull();

    manager.askDeleteBookmark(bookmark!);
    await manager.confirmDelete();
    expect(manager.toast.value?.actionLabel).toBe('撤销');

    dataRef.value = transformBookmarkTree(
      makeTree([
        nativeBookmark(
          'bm-google',
          '1',
          0,
          'Google',
          'https://www.google.com/',
        ),
      ]),
    );

    manager.runToastAction();
    await waitForToastAction();

    expect(service.createBookmark).toHaveBeenCalledWith({
      parentId: '2',
      title: 'GitHub',
      url: 'https://github.com/',
    });
    expect(manager.toast.value?.message).toBe(
      '原文件夹已不存在，书签已恢复到其他书签',
    );
    manager.dismissToast();
  });
});
