import {
  isProtectedSystemNodeId,
  type NativeBookmarkNode,
} from '../types/bookmark';
import { getErrorMessage } from '../utils/errors';
import {
  normalizeBookmarkTitle,
  normalizeBookmarkUrl,
  normalizeIndex,
  normalizeNodeId,
} from '../utils/url';

/** 书签 API 失败时抛出的错误，消息可直接展示给用户。 */
export class BookmarkApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookmarkApiError';
  }
}

export type BookmarksApi = Pick<
  typeof chrome.bookmarks,
  | 'getTree'
  | 'getSubTree'
  | 'create'
  | 'update'
  | 'move'
  | 'remove'
  | 'removeTree'
  | 'onCreated'
  | 'onRemoved'
  | 'onChanged'
  | 'onMoved'
  | 'onChildrenReordered'
  | 'onImportEnded'
>;

export interface BookmarkTreeDataSource {
  getTree(): Promise<NativeBookmarkNode[]>;
  /** 订阅任意原生书签变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
}

export interface CreateBookmarkInput {
  parentId: string;
  title: string;
  url: string;
  index?: number;
}

export interface CreateFolderInput {
  parentId: string;
  title: string;
  index?: number;
}

export interface UpdateBookmarkInput {
  title?: string;
  url?: string;
}

export interface MoveDestination {
  parentId?: string;
  index?: number;
}

export interface BookmarkService extends BookmarkTreeDataSource {
  getSubTree(id: string): Promise<NativeBookmarkNode | null>;
  createBookmark(input: CreateBookmarkInput): Promise<NativeBookmarkNode>;
  createFolder(input: CreateFolderInput): Promise<NativeBookmarkNode>;
  updateBookmark(id: string, changes: UpdateBookmarkInput): Promise<NativeBookmarkNode>;
  renameFolder(id: string, title: string): Promise<NativeBookmarkNode>;
  moveBookmark(id: string, destination: MoveDestination): Promise<NativeBookmarkNode>;
  moveFolder(id: string, destination: MoveDestination): Promise<NativeBookmarkNode>;
  removeBookmark(id: string): Promise<void>;
  removeFolder(id: string): Promise<void>;
}

type BookmarksApiProvider = () => BookmarksApi;

function resolveBookmarksApi(): BookmarksApi {
  if (typeof chrome === 'undefined' || !chrome.bookmarks) {
    throw new BookmarkApiError('当前环境无法访问 Chrome 书签 API，请在新标签页扩展环境中打开');
  }
  return chrome.bookmarks;
}

/**
 * 创建书签服务。
 *
 * 通过参数注入 API，便于单元测试；生产环境使用单例 bookmarkService。
 * 所有写操作都以 Chrome Bookmarks API 为唯一数据源，不做本地副本。
 */
export function createBookmarkService(
  apiProvider: BookmarksApiProvider = resolveBookmarksApi,
): BookmarkService {
  const api = (): BookmarksApi => apiProvider();

  async function performMove(
    nodeId: string,
    destination: MoveDestination,
    actionLabel: string,
  ): Promise<NativeBookmarkNode> {
    const parentId =
      destination.parentId === undefined
        ? undefined
        : normalizeNodeId(destination.parentId, '目标文件夹 ID');
    const index = normalizeIndex(destination.index);

    if (parentId === undefined && index === undefined) {
      throw new BookmarkApiError(`${actionLabel}时必须指定目标文件夹或排序位置`);
    }

    const target: chrome.bookmarks.MoveDestination = {};
    if (parentId !== undefined) {
      target.parentId = parentId;
    }
    if (index !== undefined) {
      target.index = index;
    }

    try {
      return await api().move(nodeId, target);
    } catch (error) {
      throw wrapApiError(actionLabel, error);
    }
  }

  return {
    async getTree() {
      try {
        return await api().getTree();
      } catch (error) {
        throw wrapApiError('读取书签树', error);
      }
    },

    async getSubTree(id) {
      const nodeId = normalizeNodeId(id);
      try {
        const nodes = await api().getSubTree(nodeId);
        return nodes[0] ?? null;
      } catch (error) {
        throw wrapApiError('读取书签子树', error);
      }
    },

    async createBookmark(input) {
      const parentId = normalizeNodeId(input.parentId, '父文件夹 ID');
      const title = normalizeBookmarkTitle(input.title, '书签名称');
      const url = normalizeBookmarkUrl(input.url);
      const index = normalizeIndex(input.index);

      try {
        const details: chrome.bookmarks.CreateDetails = {
          parentId,
          title,
          url,
        };
        if (index !== undefined) {
          details.index = index;
        }
        return await api().create(details);
      } catch (error) {
        throw wrapApiError('新增书签', error);
      }
    },

    async createFolder(input) {
      const parentId = normalizeNodeId(input.parentId, '父文件夹 ID');
      const title = normalizeBookmarkTitle(input.title, '文件夹名称');
      const index = normalizeIndex(input.index);

      try {
        const details: chrome.bookmarks.CreateDetails = {
          parentId,
          title,
        };
        if (index !== undefined) {
          details.index = index;
        }
        return await api().create(details);
      } catch (error) {
        throw wrapApiError('新建文件夹', error);
      }
    },

    async updateBookmark(id, changes) {
      const nodeId = assertMutableNodeId(id, '修改');
      const nextChanges: chrome.bookmarks.UpdateChanges = {};

      if (changes.title !== undefined) {
        nextChanges.title = normalizeBookmarkTitle(changes.title, '书签名称');
      }
      if (changes.url !== undefined) {
        nextChanges.url = normalizeBookmarkUrl(changes.url);
      }

      if (nextChanges.title === undefined && nextChanges.url === undefined) {
        throw new BookmarkApiError('没有需要修改的字段');
      }

      try {
        return await api().update(nodeId, nextChanges);
      } catch (error) {
        throw wrapApiError('修改书签', error);
      }
    },

    async renameFolder(id, title) {
      const nodeId = assertMutableNodeId(id, '重命名');
      const normalizedTitle = normalizeBookmarkTitle(title, '文件夹名称');

      try {
        return await api().update(nodeId, { title: normalizedTitle });
      } catch (error) {
        throw wrapApiError('重命名文件夹', error);
      }
    },

    async moveBookmark(id, destination) {
      const nodeId = assertMutableNodeId(id, '移动');
      return performMove(nodeId, destination, '移动书签');
    },

    async moveFolder(id, destination) {
      const nodeId = assertMutableNodeId(id, '移动');
      const parentId =
        destination.parentId === undefined
          ? undefined
          : normalizeNodeId(destination.parentId, '目标文件夹 ID');

      if (parentId !== undefined) {
        if (parentId === nodeId) {
          throw new BookmarkApiError('不能将文件夹移动到自身内部');
        }

        let subtree: NativeBookmarkNode | null;
        try {
          const nodes = await api().getSubTree(nodeId);
          subtree = nodes[0] ?? null;
        } catch (error) {
          throw wrapApiError('校验文件夹移动目标', error);
        }

        if (!subtree) {
          throw new BookmarkApiError('找不到要移动的文件夹');
        }

        if (containsNodeId(subtree, parentId)) {
          throw new BookmarkApiError('不能将文件夹移动到自己的子文件夹中');
        }
      }

      return performMove(nodeId, destination, '移动文件夹');
    },

    async removeBookmark(id) {
      const nodeId = assertMutableNodeId(id, '删除');

      try {
        await api().remove(nodeId);
      } catch (error) {
        throw wrapApiError('删除书签', error);
      }
    },

    async removeFolder(id) {
      const nodeId = assertMutableNodeId(id, '删除');

      try {
        await api().removeTree(nodeId);
      } catch (error) {
        throw wrapApiError('删除文件夹', error);
      }
    },

    subscribe(listener) {
      const bookmarksApi = api();
      const handler = (): void => listener();

      bookmarksApi.onCreated.addListener(handler);
      bookmarksApi.onRemoved.addListener(handler);
      bookmarksApi.onChanged.addListener(handler);
      bookmarksApi.onMoved.addListener(handler);
      bookmarksApi.onChildrenReordered.addListener(handler);
      bookmarksApi.onImportEnded.addListener(handler);

      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        bookmarksApi.onCreated.removeListener(handler);
        bookmarksApi.onRemoved.removeListener(handler);
        bookmarksApi.onChanged.removeListener(handler);
        bookmarksApi.onMoved.removeListener(handler);
        bookmarksApi.onChildrenReordered.removeListener(handler);
        bookmarksApi.onImportEnded.removeListener(handler);
      };
    },
  };
}

function assertMutableNodeId(id: string, action: string): string {
  const nodeId = normalizeNodeId(id);
  if (isProtectedSystemNodeId(nodeId)) {
    throw new BookmarkApiError(`不能${action} Chrome 系统书签节点`);
  }
  return nodeId;
}

function containsNodeId(node: NativeBookmarkNode, targetId: string): boolean {
  if (node.id === targetId) {
    return true;
  }
  return node.children?.some((child) => containsNodeId(child, targetId)) ?? false;
}

function wrapApiError(action: string, error: unknown): BookmarkApiError {
  if (error instanceof BookmarkApiError) {
    return error;
  }
  return new BookmarkApiError(`${action}失败：${getErrorMessage(error)}`);
}

/** 生产环境共享实例；页面内只通过它读写原生书签。 */
export const bookmarkService = createBookmarkService();
