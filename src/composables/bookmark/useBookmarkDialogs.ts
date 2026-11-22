import { shallowRef, type Ref } from 'vue';
import type {
  BookmarkService,
  UpdateBookmarkInput,
} from '../../services/bookmarkService';
import {
  BOOKMARKS_BAR_ID,
  type HomepageBookmark,
  type HomepageData,
  type HomepageFolder,
} from '../../types/bookmark';
import type {
  BookmarkEditorState,
  BookmarkFormPayload,
  ConfirmDialogState,
  ContextMenuItem,
  ContextMenuState,
  FolderEditorState,
  FolderFormPayload,
  ManagedNode,
  MoveDialogState,
} from '../../types/management';
import {
  buildFolderTree,
  collectFolderSubtreeIds,
  findHomepageBookmark,
  findHomepageFolder,
  getFolderChildren,
  getNodeTitle,
  summarizeFolderContents,
} from '../../utils/folders';
import { computeDropIndex } from '../../utils/dragMove';
import { getErrorMessage } from '../../utils/errors';
import { t } from '../../i18n';
import type { DeleteSnapshot } from './useBookmarkUndo';
import type { Notify } from './types';

const CONTEXT_MENU_WIDTH = 200;
const CONTEXT_MENU_HEIGHT = 260;

/** 右键菜单项由 manager 维护，对话框层只负责打开/关闭与分发。 */
export interface BookmarkDialogMenuItems {
  bookmark: (bookmark: HomepageBookmark) => ContextMenuItem[];
  folder: (folder: HomepageFolder) => ContextMenuItem[];
}

export interface UseBookmarkDialogsOptions {
  data: Ref<HomepageData | null>;
  service: BookmarkService;
  refresh: () => Promise<void>;
  busy: Ref<boolean>;
  notify: Notify;
  dismissToast: () => void;
  exitSelection: () => void;
  topLevelSelectedNodes: () => ManagedNode[];
  notifyDeleted: (snapshot: DeleteSnapshot, message: string) => void;
  notifyBulkDeleted: (snapshots: DeleteSnapshot[]) => void;
  menuItems: BookmarkDialogMenuItems;
  openUrl: (bookmark: HomepageBookmark, newTab: boolean) => void;
}

/**
 * 书签主页的编辑器与对话框编排。
 *
 * - 统一维护书签/文件夹编辑器、确认框、移动框、右键菜单的可见状态；
 * - 所有写操作仍通过 BookmarkService，成功后由调用方刷新原生树；
 * - toast、folderOptions 与菜单项构建留在 manager，避免反馈逻辑分散；
 * - 批量删除/移动的“去重后代”由 selection 的 topLevelSelectedNodes 提供。
 */
export function useBookmarkDialogs(options: UseBookmarkDialogsOptions) {
  const dialogError = shallowRef<string | null>(null);
  const bookmarkEditor = shallowRef<BookmarkEditorState | null>(null);
  const folderEditor = shallowRef<FolderEditorState | null>(null);
  const confirmDialog = shallowRef<ConfirmDialogState | null>(null);
  const moveDialog = shallowRef<MoveDialogState | null>(null);
  const contextMenu = shallowRef<ContextMenuState | null>(null);

  function getBarId(): string {
    return options.data.value?.bookmarksBar.id ?? BOOKMARKS_BAR_ID;
  }

  function isValidFolder(parentId: string): boolean {
    return getFolderChildren(options.data.value, parentId) !== null;
  }

  function resolveCreateParent(parentId?: string): string {
    if (parentId && isValidFolder(parentId)) {
      return parentId;
    }
    return getBarId();
  }

  function openMenuAtPoint(
    x: number,
    y: number,
    items: ContextMenuItem[],
    target: ManagedNode | null,
  ): void {
    options.dismissToast();
    contextMenu.value = {
      x: Math.max(8, x),
      y: Math.max(8, y),
      items,
      target,
    };
  }

  function openMenuForElement(
    element: HTMLElement,
    items: ContextMenuItem[],
    target: ManagedNode | null,
  ): void {
    const rect = element.getBoundingClientRect();
    openMenuAtPoint(rect.right, rect.bottom + 6, items, target);
  }

  function openBookmarkContextMenu(
    event: MouseEvent,
    bookmark: HomepageBookmark,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    openMenuAtPoint(
      Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8),
      Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8),
      options.menuItems.bookmark(bookmark),
      { kind: 'bookmark', node: bookmark },
    );
  }

  function openBookmarkMenuAt(
    element: HTMLElement,
    bookmark: HomepageBookmark,
  ): void {
    openMenuForElement(element, options.menuItems.bookmark(bookmark), {
      kind: 'bookmark',
      node: bookmark,
    });
  }

  function openFolderContextMenu(
    event: MouseEvent,
    folder: HomepageFolder,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    openMenuAtPoint(
      Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8),
      Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8),
      options.menuItems.folder(folder),
      { kind: 'folder', node: folder },
    );
  }

  function openFolderMenuAt(element: HTMLElement, folder: HomepageFolder): void {
    openMenuForElement(element, options.menuItems.folder(folder), {
      kind: 'folder',
      node: folder,
    });
  }

  function openAddMenu(event: MouseEvent): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    openMenuForElement(
      target,
      [
        { id: 'create-bookmark', label: t('contextMenu.addBookmark') },
        { id: 'create-folder', label: t('contextMenu.addFolder') },
      ],
      null,
    );
  }

  function closeContextMenu(): void {
    contextMenu.value = null;
  }

  function handleContextAction(action: string): void {
    const state = contextMenu.value;
    if (!state) {
      return;
    }

    const target = state.target;
    closeContextMenu();

    if (action === 'create-bookmark') {
      openAddBookmark();
      return;
    }
    if (action === 'create-folder') {
      openAddFolder();
      return;
    }
    if (!target) {
      return;
    }

    if (target.kind === 'bookmark') {
      switch (action) {
        case 'open':
          options.openUrl(target.node, false);
          break;
        case 'open-new':
          options.openUrl(target.node, true);
          break;
        case 'edit':
          openEditBookmark(target.node);
          break;
        case 'move':
          openMoveDialog(target);
          break;
        case 'delete-bookmark':
          askDeleteBookmark(target.node);
          break;
      }
      return;
    }

    switch (action) {
      case 'add-bookmark':
        openAddBookmark(target.node.id);
        break;
      case 'add-subfolder':
        openAddFolder(target.node.id);
        break;
      case 'rename-folder':
        openRenameFolder(target.node);
        break;
      case 'move':
        openMoveDialog(target);
        break;
      case 'delete-folder':
        askDeleteFolder(target.node);
        break;
    }
  }

  function openAddBookmark(parentId?: string): void {
    if (options.busy.value) {
      return;
    }
    options.dismissToast();
    dialogError.value = null;
    bookmarkEditor.value = {
      mode: 'create',
      defaultParentId: resolveCreateParent(parentId),
    };
  }

  function openEditBookmark(bookmark: HomepageBookmark): void {
    if (options.busy.value) {
      return;
    }
    options.dismissToast();
    dialogError.value = null;
    bookmarkEditor.value = { mode: 'edit', bookmark };
  }

  function openAddFolder(parentId?: string): void {
    if (options.busy.value) {
      return;
    }
    options.dismissToast();
    dialogError.value = null;
    folderEditor.value = {
      mode: 'create',
      defaultParentId: resolveCreateParent(parentId),
    };
  }

  function openRenameFolder(folder: HomepageFolder): void {
    if (options.busy.value) {
      return;
    }
    options.dismissToast();
    dialogError.value = null;
    folderEditor.value = { mode: 'rename', folder };
  }

  function closeBookmarkEditor(): void {
    if (options.busy.value) {
      return;
    }
    bookmarkEditor.value = null;
    dialogError.value = null;
  }

  function closeFolderEditor(): void {
    if (options.busy.value) {
      return;
    }
    folderEditor.value = null;
    dialogError.value = null;
  }

  async function saveBookmark(payload: BookmarkFormPayload): Promise<void> {
    const state = bookmarkEditor.value;
    if (!state || options.busy.value) {
      return;
    }

    options.busy.value = true;
    dialogError.value = null;

    try {
      const title = payload.title.trim();

      if (state.mode === 'create') {
        await options.service.createBookmark({
          parentId: payload.parentId,
          title,
          url: payload.url,
        });
        await options.refresh();
        bookmarkEditor.value = null;
        options.notify('success', t('manager.bookmarkCreated'));
        return;
      }

      const changes: UpdateBookmarkInput = {};
      if (title !== state.bookmark.title.trim()) {
        changes.title = title;
      }
      if (payload.url.trim() !== state.bookmark.url) {
        changes.url = payload.url;
      }

      if (changes.title === undefined && changes.url === undefined) {
        bookmarkEditor.value = null;
        options.notify('success', t('manager.noChanges'));
        return;
      }

      await options.service.updateBookmark(state.bookmark.id, changes);
      await options.refresh();
      bookmarkEditor.value = null;
      options.notify('success', t('manager.bookmarkSaved'));
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      options.busy.value = false;
    }
  }

  async function saveFolder(payload: FolderFormPayload): Promise<void> {
    const state = folderEditor.value;
    if (!state || options.busy.value) {
      return;
    }

    options.busy.value = true;
    dialogError.value = null;

    try {
      const title = payload.title.trim();

      if (state.mode === 'create') {
        await options.service.createFolder({
          parentId: payload.parentId,
          title,
        });
        await options.refresh();
        folderEditor.value = null;
        options.notify('success', t('manager.folderCreated'));
        return;
      }

      if (title === state.folder.title.trim()) {
        folderEditor.value = null;
        options.notify('success', t('manager.noChanges'));
        return;
      }

      await options.service.renameFolder(state.folder.id, title);
      await options.refresh();
      folderEditor.value = null;
      options.notify('success', t('manager.folderRenamed'));
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      options.busy.value = false;
    }
  }

  function askDeleteBookmark(bookmark: HomepageBookmark): void {
    if (options.busy.value) {
      return;
    }
    options.dismissToast();
    dialogError.value = null;
    confirmDialog.value = {
      target: { kind: 'bookmark', node: bookmark },
      title: t('manager.confirmDeleteBookmarkTitle', {
        name: getNodeTitle(bookmark),
      }),
      message: t('manager.confirmDeleteBookmarkMessage'),
      warning: null,
      confirmLabel: t('contextMenu.deleteBookmark'),
    };
  }

  function askDeleteFolder(folder: HomepageFolder): void {
    if (options.busy.value) {
      return;
    }

    const summary = summarizeFolderContents(folder);
    const hasChildren = summary.bookmarkCount > 0 || summary.folderCount > 0;
    const warning = hasChildren
      ? t('manager.confirmDeleteFolderWithChildren', {
          bookmarkCount: summary.bookmarkCount,
          folderCount: summary.folderCount,
        })
      : t('manager.confirmDeleteEmptyFolder');

    options.dismissToast();
    dialogError.value = null;
    confirmDialog.value = {
      target: { kind: 'folder', node: folder },
      title: t('manager.confirmDeleteFolderTitle', {
        name: getNodeTitle(folder),
      }),
      message: t('manager.confirmDeleteFolderMessage'),
      warning,
      confirmLabel: t('contextMenu.deleteFolder'),
    };
  }

  function closeConfirmDialog(): void {
    if (options.busy.value) {
      return;
    }
    confirmDialog.value = null;
    dialogError.value = null;
  }

  function askBulkDelete(): void {
    const nodes = options.topLevelSelectedNodes();
    if (nodes.length === 0 || options.busy.value) {
      return;
    }

    options.dismissToast();
    dialogError.value = null;
    confirmDialog.value = {
      target: nodes[0]!,
      title: t('manager.confirmBulkDeleteTitle', { count: nodes.length }),
      message: t('manager.confirmBulkDeleteMessage'),
      warning: null,
      confirmLabel: t('manager.confirmBulkDeleteLabel'),
      bulkIds: nodes.map((target) => target.node.id),
    };
  }

  function openBulkMoveDialog(): void {
    const nodes = options.topLevelSelectedNodes();
    if (nodes.length === 0 || options.busy.value || !options.data.value) {
      return;
    }

    const first = nodes[0]!;
    const excluded = new Set<string>();
    for (const target of nodes) {
      if (target.kind === 'folder') {
        for (const id of collectFolderSubtreeIds(target.node)) {
          excluded.add(id);
        }
      }
    }
    options.dismissToast();
    dialogError.value = null;
    moveDialog.value = {
      target: first,
      tree: buildFolderTree(options.data.value, excluded),
      currentParentId: first.node.parentId,
      bulkIds: nodes.map((target) => target.node.id),
    };
  }

  async function confirmDelete(): Promise<void> {
    const state = confirmDialog.value;
    if (!state || options.busy.value) {
      return;
    }

    if (state.bulkIds && state.bulkIds.length > 0) {
      const snapshots: DeleteSnapshot[] = [];
      for (const id of state.bulkIds) {
        const bookmark = findHomepageBookmark(options.data.value, id);
        if (bookmark) {
          snapshots.push({
            target: { kind: 'bookmark', node: bookmark },
            parentId: bookmark.parentId,
          });
          continue;
        }
        const folder = findHomepageFolder(options.data.value, id);
        if (folder) {
          snapshots.push({
            target: { kind: 'folder', node: folder },
            parentId: folder.parentId,
          });
        }
      }
      if (snapshots.length === 0) {
        confirmDialog.value = null;
        return;
      }

      options.busy.value = true;
      dialogError.value = null;
      try {
        for (const snapshot of snapshots) {
          if (snapshot.target.kind === 'bookmark') {
            await options.service.removeBookmark(snapshot.target.node.id);
          } else {
            await options.service.removeFolder(snapshot.target.node.id);
          }
        }
        await options.refresh();
        confirmDialog.value = null;
        options.exitSelection();
        options.notifyBulkDeleted(snapshots);
      } catch (error) {
        dialogError.value = getErrorMessage(error);
      } finally {
        options.busy.value = false;
      }
      return;
    }

    const target = state.target;
    const snapshot: DeleteSnapshot = {
      target,
      parentId: target.node.parentId,
    };
    options.busy.value = true;
    dialogError.value = null;

    try {
      if (target.kind === 'bookmark') {
        await options.service.removeBookmark(target.node.id);
      } else {
        await options.service.removeFolder(target.node.id);
      }

      await options.refresh();
      confirmDialog.value = null;

      if (target.kind === 'bookmark') {
        options.notifyDeleted(snapshot, t('manager.bookmarkDeleted'));
      } else if (target.node.children.length === 0) {
        options.notifyDeleted(snapshot, t('manager.emptyFolderDeleted'));
      } else {
        options.notifyDeleted(snapshot, t('manager.folderDeleted'));
      }
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      options.busy.value = false;
    }
  }

  function openMoveDialog(target: ManagedNode): void {
    if (options.busy.value || !options.data.value) {
      return;
    }

    const excluded =
      target.kind === 'folder'
        ? collectFolderSubtreeIds(target.node)
        : new Set<string>();
    const tree = buildFolderTree(options.data.value, excluded);

    if (tree.length === 0) {
      options.notify('error', t('manager.noTargetFolder'));
      return;
    }

    options.dismissToast();
    dialogError.value = null;
    moveDialog.value = {
      target,
      tree,
      currentParentId: target.node.parentId,
    };
  }

  function closeMoveDialog(): void {
    if (options.busy.value) {
      return;
    }
    moveDialog.value = null;
    dialogError.value = null;
  }

  async function confirmMove(parentId: string): Promise<void> {
    const state = moveDialog.value;
    if (!state || options.busy.value) {
      return;
    }

    if (state.bulkIds && state.bulkIds.length > 0) {
      options.busy.value = true;
      dialogError.value = null;
      try {
        for (const id of state.bulkIds) {
          const bookmark = findHomepageBookmark(options.data.value, id);
          if (bookmark) {
            await options.service.moveBookmark(id, { parentId });
            continue;
          }
          const folder = findHomepageFolder(options.data.value, id);
          if (folder) {
            await options.service.moveFolder(id, { parentId });
          }
        }
        await options.refresh();
        moveDialog.value = null;
        options.exitSelection();
        options.notify(
          'success',
          t('manager.bulkMoved', { count: state.bulkIds.length }),
        );
      } catch (error) {
        dialogError.value = getErrorMessage(error);
      } finally {
        options.busy.value = false;
      }
      return;
    }

    if (parentId === state.currentParentId) {
      dialogError.value = t('manager.sameDestination');
      return;
    }

    const siblings = getFolderChildren(options.data.value, parentId);
    if (!siblings) {
      dialogError.value = t('manager.destinationMissing');
      return;
    }

    const index = computeDropIndex(siblings, state.target.node.id);
    if (index === null) {
      dialogError.value = t('manager.cannotComputeDestination');
      return;
    }

    options.busy.value = true;
    dialogError.value = null;

    try {
      if (state.target.kind === 'bookmark') {
        await options.service.moveBookmark(state.target.node.id, {
          parentId,
          index,
        });
      } else {
        await options.service.moveFolder(state.target.node.id, {
          parentId,
          index,
        });
      }

      await options.refresh();
      moveDialog.value = null;
      options.notify('success', t('manager.bookmarkMoved'));
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      options.busy.value = false;
    }
  }

  return {
    dialogError,
    bookmarkEditor,
    folderEditor,
    confirmDialog,
    moveDialog,
    contextMenu,
    openBookmarkContextMenu,
    openBookmarkMenuAt,
    openFolderContextMenu,
    openFolderMenuAt,
    openAddMenu,
    handleContextAction,
    closeContextMenu,
    openAddBookmark,
    openEditBookmark,
    openAddFolder,
    openRenameFolder,
    closeBookmarkEditor,
    closeFolderEditor,
    saveBookmark,
    saveFolder,
    askDeleteBookmark,
    askDeleteFolder,
    closeConfirmDialog,
    askBulkDelete,
    confirmDelete,
    openMoveDialog,
    closeMoveDialog,
    openBulkMoveDialog,
    confirmMove,
  };
}
