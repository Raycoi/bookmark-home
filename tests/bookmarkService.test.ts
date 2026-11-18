import { describe, expect, it, vi } from 'vitest';
import {
  BookmarkApiError,
  createBookmarkService,
  type BookmarksApi,
} from '../src/services/bookmarkService';
import type { NativeBookmarkNode } from '../src/types/bookmark';
import { BookmarkValidationError } from '../src/utils/url';
import { nativeBookmark } from './fixtures/bookmarkTree';

function createEvent() {
  return {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn(() => false),
    hasListeners: vi.fn(() => false),
    dispatch: vi.fn(),
  };
}

function createMockApi() {
  const created = nativeBookmark('created', '1', 0, '新书签', 'https://example.com/');

  const api = {
    getTree: vi.fn(async (): Promise<NativeBookmarkNode[]> => []),
    getSubTree: vi.fn(async (): Promise<NativeBookmarkNode[]> => []),
    create: vi.fn(async (): Promise<NativeBookmarkNode> => created),
    update: vi.fn(async (): Promise<NativeBookmarkNode> => created),
    move: vi.fn(async (): Promise<NativeBookmarkNode> => created),
    remove: vi.fn(async (): Promise<void> => undefined),
    removeTree: vi.fn(async (): Promise<void> => undefined),
    onCreated: createEvent(),
    onRemoved: createEvent(),
    onChanged: createEvent(),
    onMoved: createEvent(),
    onChildrenReordered: createEvent(),
    onImportEnded: createEvent(),
  };

  return api;
}

function setup() {
  const api = createMockApi();
  const service = createBookmarkService(() => api as unknown as BookmarksApi);
  return { api, service };
}

describe('bookmarkService 读取', () => {
  it('读取完整书签树和子树', async () => {
    const { api, service } = setup();
    const tree = [
      { id: '0', title: '', children: [{ id: '1', parentId: '0', title: '书签栏' }] },
    ];
    api.getTree.mockResolvedValue(tree);
    api.getSubTree.mockResolvedValue(tree);

    await expect(service.getTree()).resolves.toEqual(tree);
    await expect(service.getSubTree('0')).resolves.toEqual(tree[0]);
    expect(api.getSubTree).toHaveBeenCalledWith('0');
  });

  it('子树不存在时返回 null', async () => {
    const { service } = setup();
    await expect(service.getSubTree('missing')).resolves.toBeNull();
  });

  it('把底层读取错误包装为中文错误', async () => {
    const { api, service } = setup();
    api.getTree.mockRejectedValueOnce(new Error('Cannot access bookmarks'));

    await expect(service.getTree()).rejects.toThrow(
      '读取书签树失败：Cannot access bookmarks',
    );
  });
});

describe('bookmarkService 写入', () => {
  it('新增网址时校验并规范化字段，直接调用 chrome.bookmarks.create', async () => {
    const { api, service } = setup();

    await service.createBookmark({
      parentId: ' 1 ',
      title: '  Example  ',
      url: 'example.com',
      index: 2,
    });

    expect(api.create).toHaveBeenCalledWith({
      parentId: '1',
      title: 'Example',
      url: 'https://example.com/',
      index: 2,
    });
  });

  it('新增文件夹时不携带 url', async () => {
    const { api, service } = setup();

    await service.createFolder({ parentId: '1', title: '  新分类  ' });

    expect(api.create).toHaveBeenCalledWith({
      parentId: '1',
      title: '新分类',
    });
  });

  it('支持保存到书签栏、其他书签和现有文件夹', async () => {
    const { api, service } = setup();

    await service.createBookmark({
      parentId: '1',
      title: '书签栏',
      url: 'https://bar.example/',
    });
    await service.createBookmark({
      parentId: '2',
      title: '其他书签',
      url: 'https://other.example/',
    });
    await service.createBookmark({
      parentId: 'folder-1',
      title: '文件夹',
      url: 'https://folder.example/',
    });
    await service.createFolder({ parentId: '2', title: '其他书签里的文件夹' });

    expect(api.create).toHaveBeenNthCalledWith(1, {
      parentId: '1',
      title: '书签栏',
      url: 'https://bar.example/',
    });
    expect(api.create).toHaveBeenNthCalledWith(2, {
      parentId: '2',
      title: '其他书签',
      url: 'https://other.example/',
    });
    expect(api.create).toHaveBeenNthCalledWith(3, {
      parentId: 'folder-1',
      title: '文件夹',
      url: 'https://folder.example/',
    });
    expect(api.create).toHaveBeenNthCalledWith(4, {
      parentId: '2',
      title: '其他书签里的文件夹',
    });
  });

  it('非法网址不会调用 Chrome API', async () => {
    const { api, service } = setup();

    await expect(
      service.createBookmark({ parentId: '1', title: '危险', url: 'javascript:alert(1)' }),
    ).rejects.toThrow(BookmarkValidationError);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('修改书签名称和网址', async () => {
    const { api, service } = setup();

    await service.updateBookmark('10', { title: ' 新名称 ', url: 'https://new.example/' });

    expect(api.update).toHaveBeenCalledWith('10', {
      title: '新名称',
      url: 'https://new.example/',
    });
  });

  it('没有修改字段时直接报错，不调用 API', async () => {
    const { api, service } = setup();

    await expect(service.updateBookmark('10', {})).rejects.toThrow('没有需要修改的字段');
    expect(api.update).not.toHaveBeenCalled();
  });

  it('重命名文件夹', async () => {
    const { api, service } = setup();

    await service.renameFolder('20', '  新文件夹名 ');

    expect(api.update).toHaveBeenCalledWith('20', { title: '新文件夹名' });
  });

  it('移动书签到目标文件夹和位置', async () => {
    const { api, service } = setup();

    await service.moveBookmark('30', { parentId: '2', index: 3 });

    expect(api.move).toHaveBeenCalledWith('30', { parentId: '2', index: 3 });
  });

  it('移动时未指定目标时报错', async () => {
    const { api, service } = setup();

    await expect(service.moveBookmark('30', {})).rejects.toThrow(
      '移动书签时必须指定目标文件夹或排序位置',
    );
    expect(api.move).not.toHaveBeenCalled();
  });

  it('显式移动书签使用 moveBookmark', async () => {
    const { api, service } = setup();

    await service.moveBookmark('30', { parentId: 'folder-1', index: 1 });

    expect(api.move).toHaveBeenCalledWith('30', {
      parentId: 'folder-1',
      index: 1,
    });
  });

  it('移动文件夹前校验目标不能是自身或后代', async () => {
    const { api, service } = setup();
    const sourceFolder: NativeBookmarkNode = {
      id: 'folder-source',
      parentId: '1',
      title: '源文件夹',
      children: [
        {
          id: 'folder-child',
          parentId: 'folder-source',
          title: '子文件夹',
          children: [],
        },
      ],
    };
    api.getSubTree.mockResolvedValue([sourceFolder]);

    await expect(
      service.moveFolder('folder-source', { parentId: 'folder-source' }),
    ).rejects.toThrow('不能将文件夹移动到自身内部');
    await expect(
      service.moveFolder('folder-source', { parentId: 'folder-child' }),
    ).rejects.toThrow('不能将文件夹移动到自己的子文件夹中');
    expect(api.move).not.toHaveBeenCalled();
  });

  it('合法文件夹移动会调用 moveFolder', async () => {
    const { api, service } = setup();
    api.getSubTree.mockResolvedValue([
      {
        id: 'folder-source',
        parentId: '1',
        title: '源文件夹',
        children: [],
      },
    ]);

    await service.moveFolder('folder-source', { parentId: '2', index: 0 });

    expect(api.move).toHaveBeenCalledWith('folder-source', {
      parentId: '2',
      index: 0,
    });
  });

  it('删除网址使用 remove，删除文件夹使用 removeTree', async () => {
    const { api, service } = setup();

    await service.removeBookmark('40');
    await service.removeFolder('41');

    expect(api.remove).toHaveBeenCalledWith('40');
    expect(api.removeTree).toHaveBeenCalledWith('41');
  });

  it('阻止修改、移动或删除 Chrome 系统节点', async () => {
    const { api, service } = setup();

    await expect(service.removeFolder('1')).rejects.toThrow(
      '不能删除 Chrome 系统书签节点',
    );
    await expect(service.removeBookmark('0')).rejects.toThrow(
      '不能删除 Chrome 系统书签节点',
    );
    await expect(service.moveBookmark('2', { parentId: '1' })).rejects.toThrow(
      '不能移动 Chrome 系统书签节点',
    );
    await expect(service.renameFolder('3', '新名称')).rejects.toThrow(
      '不能重命名 Chrome 系统书签节点',
    );

    expect(api.remove).not.toHaveBeenCalled();
    expect(api.removeTree).not.toHaveBeenCalled();
    expect(api.move).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('API 失败时保留操作上下文并转为中文错误', async () => {
    const { api, service } = setup();
    api.create.mockRejectedValueOnce(new Error('quota exceeded'));

    const operation = service.createBookmark({
      parentId: '1',
      title: '测试',
      url: 'https://example.com/',
    });

    await expect(operation).rejects.toBeInstanceOf(BookmarkApiError);
    await expect(operation).rejects.toThrow('新增书签失败：quota exceeded');
  });
});

describe('bookmarkService 事件订阅', () => {
  it('订阅全部六类书签事件，取消订阅时全部移除', () => {
    const { api, service } = setup();
    const listener = vi.fn(() => undefined);

    const unsubscribe = service.subscribe(listener);

    const events = [
      api.onCreated,
      api.onRemoved,
      api.onChanged,
      api.onMoved,
      api.onChildrenReordered,
      api.onImportEnded,
    ];

    events.forEach((event) => {
      expect(event.addListener).toHaveBeenCalledTimes(1);
    });

    const handler = api.onCreated.addListener.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf('function');
    handler?.();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();

    events.forEach((event) => {
      expect(event.removeListener).toHaveBeenCalledTimes(1);
    });
  });
});
