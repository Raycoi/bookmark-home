import {
  isProtectedSystemNodeId,
  type NativeBookmarkNode,
} from '../types/bookmark';
import { getErrorMessage } from '../utils/errors';
import { t } from '../i18n';
import {
  normalizeBookmarkTitle,
  normalizeBookmarkUrl,
  normalizeIndex,
  normalizeNodeId,
} from '../utils/url';

/** 受保护的系统节点操作，用来选择对应的错误文案。 */
type ProtectedNodeAction = 'edit' | 'rename' | 'move' | 'delete';

const PROTECTED_NODE_MESSAGE_KEYS: Record<ProtectedNodeAction, string> = {
  edit: 'bookmark.error.protectedEdit',
  rename: 'bookmark.error.protectedRename',
  move: 'bookmark.error.protectedMove',
  delete: 'bookmark.error.protectedDelete',
};

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
    throw new BookmarkApiError(t('bookmark.error.apiUnavailable'));
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
        : normalizeNodeId(destination.parentId, t('bookmark.label.targetFolderId'));
    const index = normalizeIndex(destination.index);

    if (parentId === undefined && index === undefined) {
      throw new BookmarkApiError(
        t('bookmark.error.destinationRequired', { action: actionLabel }),
      );
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
        throw wrapApiError(t('bookmark.action.readTree'), error);
      }
    },

    async getSubTree(id) {
      const nodeId = normalizeNodeId(id);
      try {
        const nodes = await api().getSubTree(nodeId);
        return nodes[0] ?? null;
      } catch (error) {
        throw wrapApiError(t('bookmark.action.readSubTree'), error);
      }
    },

    async createBookmark(input) {
      const parentId = normalizeNodeId(
        input.parentId,
        t('bookmark.label.parentFolderId'),
      );
      const title = normalizeBookmarkTitle(
        input.title,
        t('bookmark.label.bookmarkName'),
      );
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
        throw wrapApiError(t('bookmark.action.createBookmark'), error);
      }
    },

    async createFolder(input) {
      const parentId = normalizeNodeId(
        input.parentId,
        t('bookmark.label.parentFolderId'),
      );
      const title = normalizeBookmarkTitle(
        input.title,
        t('bookmark.label.folderName'),
      );
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
        throw wrapApiError(t('bookmark.action.createFolder'), error);
      }
    },

    async updateBookmark(id, changes) {
      const nodeId = assertMutableNodeId(id, 'edit');
      const nextChanges: chrome.bookmarks.UpdateChanges = {};

      if (changes.title !== undefined) {
        nextChanges.title = normalizeBookmarkTitle(
          changes.title,
          t('bookmark.label.bookmarkName'),
        );
      }
      if (changes.url !== undefined) {
        nextChanges.url = normalizeBookmarkUrl(changes.url);
      }

      if (nextChanges.title === undefined && nextChanges.url === undefined) {
        throw new BookmarkApiError(t('bookmark.error.noChanges'));
      }

      try {
        return await api().update(nodeId, nextChanges);
      } catch (error) {
        throw wrapApiError(t('bookmark.action.updateBookmark'), error);
      }
    },

    async renameFolder(id, title) {
      const nodeId = assertMutableNodeId(id, 'rename');
      const normalizedTitle = normalizeBookmarkTitle(
        title,
        t('bookmark.label.folderName'),
      );

      try {
        return await api().update(nodeId, { title: normalizedTitle });
      } catch (error) {
        throw wrapApiError(t('bookmark.action.renameFolder'), error);
      }
    },

    async moveBookmark(id, destination) {
      const nodeId = assertMutableNodeId(id, 'move');
      return performMove(nodeId, destination, t('bookmark.action.moveBookmark'));
    },

    async moveFolder(id, destination) {
      const nodeId = assertMutableNodeId(id, 'move');
      const parentId =
        destination.parentId === undefined
          ? undefined
          : normalizeNodeId(
              destination.parentId,
              t('bookmark.label.targetFolderId'),
            );

      if (parentId !== undefined) {
        if (parentId === nodeId) {
          throw new BookmarkApiError(t('bookmark.error.moveIntoSelf'));
        }

        let subtree: NativeBookmarkNode | null;
        try {
          const nodes = await api().getSubTree(nodeId);
          subtree = nodes[0] ?? null;
        } catch (error) {
          throw wrapApiError(t('bookmark.action.validateMove'), error);
        }

        if (!subtree) {
          throw new BookmarkApiError(t('bookmark.error.folderNotFound'));
        }

        if (containsNodeId(subtree, parentId)) {
          throw new BookmarkApiError(t('bookmark.error.moveIntoDescendant'));
        }
      }

      return performMove(nodeId, destination, t('bookmark.action.moveFolder'));
    },

    async removeBookmark(id) {
      const nodeId = assertMutableNodeId(id, 'delete');

      try {
        await api().remove(nodeId);
      } catch (error) {
        throw wrapApiError(t('bookmark.action.removeBookmark'), error);
      }
    },

    async removeFolder(id) {
      const nodeId = assertMutableNodeId(id, 'delete');

      try {
        await api().removeTree(nodeId);
      } catch (error) {
        throw wrapApiError(t('bookmark.action.removeFolder'), error);
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

function assertMutableNodeId(
  id: string,
  action: ProtectedNodeAction,
): string {
  const nodeId = normalizeNodeId(id);
  if (isProtectedSystemNodeId(nodeId)) {
    throw new BookmarkApiError(t(PROTECTED_NODE_MESSAGE_KEYS[action]));
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
  return new BookmarkApiError(
    t('bookmark.error.actionFailed', {
      action,
      message: getErrorMessage(error),
    }),
  );
}

/** 生产环境共享实例；页面内只通过它读写原生书签。 */
export const bookmarkService = createBookmarkService();
