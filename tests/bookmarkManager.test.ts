import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { transformBookmarkTree } from '../src/adapters/bookmarkAdapter';
import { useBookmarkManager } from '../src/composables/useBookmarkManager';
import type {
  BookmarkService,
  CreateBookmarkInput,
  CreateFolderInput,
  MoveDestination,
  UpdateBookmarkInput,
} from '../src/services/bookmarkService';
import type { HomepageData, HomepageFolder, NativeBookmarkNode } from '../src/types/bookmark';
import { flattenFolderOptions } from '../src/utils/folders';
import {
  makeStandardTree,
  makeTree,
  nativeBookmark,
} from './fixtures/bookmarkTree';

const created = nativeBookmark(
  'created',
  '1',
  0,
  'created',
  'https://created.example/',
);

function createService() {
  return {
    getTree: vi.fn(async (): Promise<NativeBookmarkNode[]> => []),
    getSubTree: vi.fn(async (): Promise<NativeBookmarkNode | null> => null),
    subscribe: vi.fn((_listener: () => void) => () => undefined),
    createBookmark: vi.fn(
      async (_input: CreateBookmarkInput): Promise<NativeBookmarkNode> => created,
    ),
    createFolder: vi.fn(
      async (_input: CreateFolderInput): Promise<NativeBookmarkNode> => created,
    ),
    updateBookmark: vi.fn(
      async (_id: string, _changes: UpdateBookmarkInput): Promise<NativeBookmarkNode> =>
        created,
    ),
    renameFolder: vi.fn(
      async (_id: string, _title: string): Promise<NativeBookmarkNode> => created,
    ),
    moveBookmark: vi.fn(
      async (_id: string, _destination: MoveDestination): Promise<NativeBookmarkNode> =>
        created,
    ),
    moveFolder: vi.fn(
      async (_id: string, _destination: MoveDestination): Promise<NativeBookmarkNode> =>
        created,
    ),
    removeBookmark: vi.fn(async (_id: string): Promise<void> => undefined),
    removeFolder: vi.fn(async (_id: string): Promise<void> => undefined),
  } satisfies BookmarkService;
}

function setup(data: HomepageData = transformBookmarkTree(makeStandardTree())) {
  const dataRef = ref<HomepageData | null>(data);
  const service = createService();
  const refresh = vi.fn(async () => undefined);
  const manager = useBookmarkManager({
    data: dataRef,
    refresh,
    service,
  });

  return { data, dataRef, service, refresh, manager };
}

function findBookmark(data: HomepageData, id: string) {
  const stack: HomepageFolder[] = [data.bookmarksBar, data.otherBookmarks];
  while (stack.length > 0) {
    const folder = stack.pop();
    if (!folder) continue;
    for (const child of folder.children) {
      if (child.type === 'bookmark' && child.id === id) {
        return child;
      }
      if (child.type === 'folder') {
        stack.push(child);
      }
    }
  }
  return null;
}

describe('useBookmarkManager 新增与编辑', () => {
  it('新增书签使用指定父文件夹，成功后刷新并关闭弹窗', async () => {
    const { manager, service, refresh } = setup();
    manager.openAddBookmark('folder-dev');

    expect(manager.bookmarkEditor.value).toEqual({
      mode: 'create',
      defaultParentId: 'folder-dev',
    });

    await manager.saveBookmark({
      title: '  New Site  ',
      url: 'new.example/path',
      parentId: 'folder-dev',
    });

    expect(service.createBookmark).toHaveBeenCalledWith({
      parentId: 'folder-dev',
      title: 'New Site',
      url: 'new.example/path',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(manager.bookmarkEditor.value).toBeNull();
    expect(manager.toast.value?.message).toBe('已新增书签');
    manager.dismissToast();
  });

  it('编辑书签只提交发生变化的字段', async () => {
    const { manager, service, data } = setup();
    const google = findBookmark(data, 'bm-google');
    expect(google).not.toBeNull();

    manager.openEditBookmark(google!);
    await manager.saveBookmark({
      title: 'Google Search',
      url: google!.url,
      parentId: google!.parentId,
    });

    expect(service.updateBookmark).toHaveBeenCalledWith('bm-google', {
      title: 'Google Search',
    });
    manager.dismissToast();

    manager.openEditBookmark(google!);
    await manager.saveBookmark({
      title: google!.title,
      url: 'google.example',
      parentId: google!.parentId,
    });

    expect(service.updateBookmark).toHaveBeenLastCalledWith('bm-google', {
      url: 'google.example',
    });
    manager.dismissToast();
  });

  it('没有变化时不调用更新 API', async () => {
    const { manager, service, data } = setup();
    const google = findBookmark(data, 'bm-google');

    manager.openEditBookmark(google!);
    await manager.saveBookmark({
      title: google!.title,
      url: google!.url,
      parentId: google!.parentId,
    });

    expect(service.updateBookmark).not.toHaveBeenCalled();
    expect(manager.bookmarkEditor.value).toBeNull();
    expect(manager.toast.value?.message).toBe('没有需要保存的修改');
    manager.dismissToast();
  });

  it('只改名称时允许保留非 http 的原 URL', async () => {
    const data = transformBookmarkTree(
      makeTree([
        nativeBookmark('bm-settings', '1', 0, '设置', 'chrome://settings/'),
      ]),
    );
    const { manager, service } = setup(data);
    const settings = findBookmark(data, 'bm-settings');

    manager.openEditBookmark(settings!);
    await manager.saveBookmark({
      title: '浏览器设置',
      url: 'chrome://settings/',
      parentId: '1',
    });

    expect(service.updateBookmark).toHaveBeenCalledWith('bm-settings', {
      title: '浏览器设置',
    });
    manager.dismissToast();
  });

  it('新增失败时保留弹窗和错误，并解除忙碌状态', async () => {
    const { manager, service } = setup();
    vi.mocked(service.createBookmark).mockRejectedValueOnce(
      new Error('quota exceeded'),
    );
    manager.openAddBookmark();

    await manager.saveBookmark({
      title: 'New',
      url: 'https://new.example/',
      parentId: '1',
    });

    expect(manager.dialogError.value).toContain('quota exceeded');
    expect(manager.bookmarkEditor.value).not.toBeNull();
    expect(manager.busy.value).toBe(false);
  });

  it('连续点击保存只执行一次写入', async () => {
    const { manager, service } = setup();
    let resolveCreate!: (node: NativeBookmarkNode) => void;
    vi.mocked(service.createBookmark).mockImplementationOnce(
      () =>
        new Promise<NativeBookmarkNode>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    manager.openAddBookmark();
    const first = manager.saveBookmark({
      title: 'Slow',
      url: 'https://slow.example/',
      parentId: '1',
    });
    const second = manager.saveBookmark({
      title: 'Slow',
      url: 'https://slow.example/',
      parentId: '1',
    });

    expect(service.createBookmark).toHaveBeenCalledTimes(1);
    resolveCreate(created);
    await Promise.all([first, second]);

    expect(service.createBookmark).toHaveBeenCalledTimes(1);
    expect(manager.bookmarkEditor.value).toBeNull();
    manager.dismissToast();
  });
});

describe('useBookmarkManager 删除与移动', () => {
  it('删除书签需确认，确认后删除并刷新', async () => {
    const { manager, service, refresh, data } = setup();
    const google = findBookmark(data, 'bm-google');

    manager.askDeleteBookmark(google!);
    expect(manager.confirmDialog.value?.title).toContain('Google');
    expect(manager.confirmDialog.value?.warning).toBeNull();

    await manager.confirmDelete();

    expect(service.removeBookmark).toHaveBeenCalledWith('bm-google');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(manager.confirmDialog.value).toBeNull();
    expect(manager.toast.value?.message).toBe('已删除书签');
    manager.dismissToast();
  });

  it('删除文件夹时显示后代数量，并调用 removeFolder', async () => {
    const { manager, service, data } = setup();
    const ai = data.bookmarksBar.folders.find((folder) => folder.id === 'folder-ai');

    manager.askDeleteFolder(ai!);

    expect(manager.confirmDialog.value?.warning).toContain('3 个书签');
    expect(manager.confirmDialog.value?.warning).toContain('0 个子文件夹');

    await manager.confirmDelete();
    expect(service.removeFolder).toHaveBeenCalledWith('folder-ai');
    manager.dismissToast();
  });

  it('移动文件夹时目标树排除自身', () => {
    const { manager, data } = setup();
    const ai = data.bookmarksBar.folders.find((folder) => folder.id === 'folder-ai');

    manager.openMoveDialog({ kind: 'folder', node: ai! });

    expect(manager.moveDialog.value?.currentParentId).toBe('1');
    const ids = flattenFolderOptions(manager.moveDialog.value!.tree).map(
      (folder) => folder.id,
    );
    expect(ids).not.toContain('folder-ai');
    expect(ids).toContain('folder-dev');
    expect(ids).toContain('2');
  });

  it('移动书签时追加到目标文件夹末尾', async () => {
    const { manager, service, data } = setup();
    const google = findBookmark(data, 'bm-google');

    manager.openMoveDialog({ kind: 'bookmark', node: google! });
    await manager.confirmMove('folder-dev');

    expect(service.moveBookmark).toHaveBeenCalledWith('bm-google', {
      parentId: 'folder-dev',
      index: 2,
    });
    expect(manager.moveDialog.value).toBeNull();
    manager.dismissToast();
  });

  it('移动文件夹使用 moveFolder，并调用移动 API', async () => {
    const { manager, service, data } = setup();
    const ai = data.bookmarksBar.folders.find((folder) => folder.id === 'folder-ai');

    manager.openMoveDialog({ kind: 'folder', node: ai! });
    await manager.confirmMove('folder-dev');

    expect(service.moveFolder).toHaveBeenCalledWith('folder-ai', {
      parentId: 'folder-dev',
      index: 2,
    });
    manager.dismissToast();
  });

  it('拒绝把当前父文件夹作为移动目标', async () => {
    const { manager, data } = setup();
    const google = findBookmark(data, 'bm-google');

    manager.openMoveDialog({ kind: 'bookmark', node: google! });
    await manager.confirmMove('1');

    expect(manager.dialogError.value).toBe('请选择其他文件夹作为目标位置');
    expect(manager.moveDialog.value).not.toBeNull();
  });
});
