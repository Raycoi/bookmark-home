import {
  computed,
  getCurrentInstance,
  inject,
  onBeforeUnmount,
  ref,
  shallowRef,
  type InjectionKey,
  type Ref,
} from 'vue';
import {
  bookmarkService,
  type BookmarkService,
} from '../services/bookmarkService';
import { recordRecentBookmark } from '../services/recentBookmarksService';
import {
  isProtectedSystemNodeId,
  type HomepageBookmark,
  type HomepageData,
  type HomepageFolder,
} from '../types/bookmark';
import type { ContextMenuItem, ToastState } from '../types/management';
import { buildFolderTree, flattenFolderOptions } from '../utils/folders';
import { getNavigableUrl } from '../utils/navigation';
import { t } from '../i18n';
import { useBookmarkDialogs } from './bookmark/useBookmarkDialogs';
import { useBookmarkDrag } from './bookmark/useBookmarkDrag';
import { useBookmarkSelection } from './bookmark/useBookmarkSelection';
import { useBookmarkUndo } from './bookmark/useBookmarkUndo';
import type { NotifyOptions } from './bookmark/types';

export interface UseBookmarkManagerOptions {
  data: Ref<HomepageData | null>;
  refresh: () => Promise<void>;
  service?: BookmarkService;
}

export type BookmarkManager = ReturnType<typeof useBookmarkManager>;

export const BOOKMARK_MANAGER_KEY: InjectionKey<BookmarkManager> =
  Symbol('bookmark-manager');

export function useBookmarkManagerContext(): BookmarkManager | null {
  return inject(BOOKMARK_MANAGER_KEY, null);
}

/**
 * 统一管理主页上的书签操作。
 *
 * - 所有写操作都通过 bookmarkService；
 * - 不在前端维护独立书签状态；
 * - 成功写入后重新读取 Chrome 原生树；
 * - 多选、拖拽、删除撤销、编辑器与对话框分别委托给 bookmark/ 下的子
 *   composable，对调用方保持同一套公开 API。
 */
export function useBookmarkManager(options: UseBookmarkManagerOptions) {
  const service = options.service ?? bookmarkService;
  const homepage = computed(() => options.data.value);

  const busy = ref(false);
  const toast = shallowRef<ToastState | null>(null);

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let toastAction: (() => void | Promise<void>) | null = null;

  function notify(
    tone: ToastState['tone'],
    message: string,
    notifyOptions: NotifyOptions = {},
  ): void {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    toastAction = notifyOptions.action ?? null;
    toast.value = {
      id: Date.now(),
      tone,
      message,
      ...(notifyOptions.actionLabel
        ? { actionLabel: notifyOptions.actionLabel }
        : {}),
    };
    toastTimer = setTimeout(
      () => {
        toast.value = null;
        toastAction = null;
        toastTimer = null;
      },
      notifyOptions.timeoutMs ?? (tone === 'error' ? 5200 : 2800),
    );
  }

  function dismissToast(): void {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastAction = null;
    toast.value = null;
  }

  function runToastAction(): void {
    const action = toastAction;
    if (!action) {
      return;
    }
    dismissToast();
    void action();
  }

  const selection = useBookmarkSelection({
    data: options.data,
    isBusy: () => busy.value,
    onEnterSelection: dismissToast,
  });

  const {
    selectionMode,
    selectedIds,
    selectedCount,
    selectedBookmarks,
    enterSelection,
    exitSelection,
    toggleSelection,
    selectBookmarkIds,
    setSelectionOrder,
  } = selection;

  const { notifyDeleted, notifyBulkDeleted } = useBookmarkUndo({
    data: options.data,
    service,
    refresh: options.refresh,
    busy,
    notify,
    exitSelection,
  });

  const folderOptions = computed(() =>
    flattenFolderOptions(buildFolderTree(homepage.value)),
  );

  function bookmarkMenuItems(bookmark: HomepageBookmark): ContextMenuItem[] {
    const canOpen = Boolean(getNavigableUrl(bookmark.url));
    return [
      { id: 'open', label: t('contextMenu.open'), disabled: !canOpen },
      { id: 'open-new', label: t('contextMenu.openNew'), disabled: !canOpen },
      { id: 'edit', label: t('contextMenu.editBookmark') },
      { id: 'move', label: t('contextMenu.moveToFolder') },
      {
        id: 'delete-bookmark',
        label: t('contextMenu.deleteBookmark'),
        danger: true,
        separatorBefore: true,
      },
    ];
  }

  function folderMenuItems(folder: HomepageFolder): ContextMenuItem[] {
    const protectedFolder = isProtectedSystemNodeId(folder.id);
    const items: ContextMenuItem[] = [
      { id: 'add-bookmark', label: t('contextMenu.addBookmark') },
      {
        id: 'add-subfolder',
        label: protectedFolder
          ? t('contextMenu.addFolder')
          : t('contextMenu.addSubfolder'),
      },
    ];

    if (!protectedFolder) {
      items.push(
        {
          id: 'rename-folder',
          label: t('contextMenu.renameFolder'),
          separatorBefore: true,
        },
        { id: 'move', label: t('contextMenu.moveToFolder') },
        {
          id: 'delete-folder',
          label: t('contextMenu.deleteFolder'),
          danger: true,
          separatorBefore: true,
        },
      );
    }

    return items;
  }

  function openUrl(bookmark: HomepageBookmark, newTab: boolean): void {
    const url = getNavigableUrl(bookmark.url);
    if (!url) {
      notify('error', t('manager.invalidUrl'));
      return;
    }

    void recordRecentBookmark({
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      folderPath: '',
    });

    if (newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      window.location.assign(url);
    }
  }

  const dialogs = useBookmarkDialogs({
    data: options.data,
    service,
    refresh: options.refresh,
    busy,
    notify,
    dismissToast,
    exitSelection,
    topLevelSelectedNodes: selection.topLevelSelectedNodes,
    notifyDeleted,
    notifyBulkDeleted,
    menuItems: {
      bookmark: bookmarkMenuItems,
      folder: folderMenuItems,
    },
    openUrl,
  });

  const drag = useBookmarkDrag({
    data: options.data,
    service,
    refresh: options.refresh,
    busy,
    notify,
    closeContextMenu: dialogs.closeContextMenu,
  });

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
    });
  }

  return {
    // 状态
    homepage,
    busy,
    dialogError: dialogs.dialogError,
    bookmarkEditor: dialogs.bookmarkEditor,
    folderEditor: dialogs.folderEditor,
    confirmDialog: dialogs.confirmDialog,
    moveDialog: dialogs.moveDialog,
    contextMenu: dialogs.contextMenu,
    toast,
    dragState: drag.dragState,
    folderOptions,
    selectionMode,
    selectedIds,
    selectedCount,
    selectedBookmarks,
    enterSelection,
    exitSelection,
    toggleSelection,
    selectBookmarkIds,
    setSelectionOrder,
    askBulkDelete: dialogs.askBulkDelete,
    openBulkMoveDialog: dialogs.openBulkMoveDialog,

    // 菜单
    openBookmarkContextMenu: dialogs.openBookmarkContextMenu,
    openBookmarkMenuAt: dialogs.openBookmarkMenuAt,
    openFolderContextMenu: dialogs.openFolderContextMenu,
    openFolderMenuAt: dialogs.openFolderMenuAt,
    openAddMenu: dialogs.openAddMenu,
    handleContextAction: dialogs.handleContextAction,
    closeContextMenu: dialogs.closeContextMenu,

    // 表单与确认
    openAddBookmark: dialogs.openAddBookmark,
    openEditBookmark: dialogs.openEditBookmark,
    openAddFolder: dialogs.openAddFolder,
    openRenameFolder: dialogs.openRenameFolder,
    closeBookmarkEditor: dialogs.closeBookmarkEditor,
    closeFolderEditor: dialogs.closeFolderEditor,
    closeConfirmDialog: dialogs.closeConfirmDialog,
    closeMoveDialog: dialogs.closeMoveDialog,
    saveBookmark: dialogs.saveBookmark,
    saveFolder: dialogs.saveFolder,
    confirmDelete: dialogs.confirmDelete,
    confirmMove: dialogs.confirmMove,
    askDeleteBookmark: dialogs.askDeleteBookmark,
    askDeleteFolder: dialogs.askDeleteFolder,
    openMoveDialog: dialogs.openMoveDialog,

    // 拖拽
    startDrag: drag.startDrag,
    endDrag: drag.endDrag,
    dragOverBookmark: drag.dragOverBookmark,
    dragLeaveBookmark: drag.dragLeaveBookmark,
    dropOnBookmark: drag.dropOnBookmark,
    dragOverFolder: drag.dragOverFolder,
    dragLeaveFolder: drag.dragLeaveFolder,
    dropOnFolder: drag.dropOnFolder,
    isBookmarkDropBefore: drag.isBookmarkDropBefore,
    isBookmarkDropAfter: drag.isBookmarkDropAfter,
    isFolderDropTarget: drag.isFolderDropTarget,
    isDraggingNode: drag.isDraggingNode,
    shouldSuppressClick: drag.shouldSuppressClick,

    // 反馈
    notify,
    dismissToast,
    runToastAction,
  };
}
