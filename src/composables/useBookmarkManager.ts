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
  type UpdateBookmarkInput,
} from '../services/bookmarkService';
import {
  BOOKMARKS_BAR_ID,
  isProtectedSystemNodeId,
  type HomepageBookmark,
  type HomepageData,
  type HomepageFolder,
} from '../types/bookmark';
import type {
  BookmarkEditorState,
  BookmarkFormPayload,
  ConfirmDialogState,
  ContextMenuItem,
  ContextMenuState,
  DragState,
  DropTarget,
  FolderEditorState,
  FolderFormPayload,
  ManagedNode,
  MoveDialogState,
  ToastState,
} from '../types/management';
import {
  buildFolderTree,
  collectFolderSubtreeIds,
  flattenFolderOptions,
  getFolderChildren,
  getNodeTitle,
  summarizeFolderContents,
} from '../utils/folders';
import { computeDropIndex } from '../utils/dragMove';
import { getErrorMessage } from '../utils/errors';
import { getNavigableUrl } from '../utils/navigation';

const CONTEXT_MENU_WIDTH = 200;
const CONTEXT_MENU_HEIGHT = 260;

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
 * - 删除与文件夹树移动都有额外保护。
 */
export function useBookmarkManager(options: UseBookmarkManagerOptions) {
  const service = options.service ?? bookmarkService;
  const homepage = computed(() => options.data.value);

  const busy = ref(false);
  const dialogError = ref<string | null>(null);
  const bookmarkEditor = shallowRef<BookmarkEditorState | null>(null);
  const folderEditor = shallowRef<FolderEditorState | null>(null);
  const confirmDialog = shallowRef<ConfirmDialogState | null>(null);
  const moveDialog = shallowRef<MoveDialogState | null>(null);
  const contextMenu = shallowRef<ContextMenuState | null>(null);
  const toast = shallowRef<ToastState | null>(null);
  const dragState = shallowRef<DragState | null>(null);

  const folderOptions = computed(() =>
    flattenFolderOptions(buildFolderTree(homepage.value)),
  );

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClickUntil = 0;

  function notify(tone: ToastState['tone'], message: string): void {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    toast.value = { id: Date.now(), tone, message };
    toastTimer = setTimeout(
      () => {
        toast.value = null;
        toastTimer = null;
      },
      tone === 'error' ? 5200 : 2800,
    );
  }

  function dismissToast(): void {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.value = null;
  }

  function getBarId(): string {
    return homepage.value?.bookmarksBar.id ?? BOOKMARKS_BAR_ID;
  }

  function isValidFolder(parentId: string): boolean {
    return getFolderChildren(homepage.value, parentId) !== null;
  }

  function resolveCreateParent(parentId?: string): string {
    if (parentId && isValidFolder(parentId)) {
      return parentId;
    }
    return getBarId();
  }

  function bookmarkMenuItems(bookmark: HomepageBookmark): ContextMenuItem[] {
    const canOpen = Boolean(getNavigableUrl(bookmark.url));
    return [
      { id: 'open', label: '打开', disabled: !canOpen },
      { id: 'open-new', label: '在新标签页打开', disabled: !canOpen },
      { id: 'edit', label: '编辑书签' },
      { id: 'move', label: '移动到文件夹…' },
      { id: 'delete-bookmark', label: '删除书签', danger: true, separatorBefore: true },
    ];
  }

  function folderMenuItems(folder: HomepageFolder): ContextMenuItem[] {
    const protectedFolder = isProtectedSystemNodeId(folder.id);
    const items: ContextMenuItem[] = [
      { id: 'add-bookmark', label: '新增书签' },
      {
        id: 'add-subfolder',
        label: protectedFolder ? '新建文件夹' : '新建子文件夹',
      },
    ];

    if (!protectedFolder) {
      items.push(
        { id: 'rename-folder', label: '重命名文件夹', separatorBefore: true },
        { id: 'move', label: '移动到文件夹…' },
        { id: 'delete-folder', label: '删除文件夹', danger: true, separatorBefore: true },
      );
    }

    return items;
  }

  function openMenuAtPoint(
    x: number,
    y: number,
    items: ContextMenuItem[],
    target: ManagedNode | null,
  ): void {
    dismissToast();
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
      bookmarkMenuItems(bookmark),
      { kind: 'bookmark', node: bookmark },
    );
  }

  function openBookmarkMenuAt(
    element: HTMLElement,
    bookmark: HomepageBookmark,
  ): void {
    openMenuForElement(element, bookmarkMenuItems(bookmark), {
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
      folderMenuItems(folder),
      { kind: 'folder', node: folder },
    );
  }

  function openFolderMenuAt(element: HTMLElement, folder: HomepageFolder): void {
    openMenuForElement(element, folderMenuItems(folder), {
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
        { id: 'create-bookmark', label: '新增书签' },
        { id: 'create-folder', label: '新建文件夹' },
      ],
      null,
    );
  }

  function closeContextMenu(): void {
    contextMenu.value = null;
  }

  function openUrl(bookmark: HomepageBookmark, newTab: boolean): void {
    const url = getNavigableUrl(bookmark.url);
    if (!url) {
      notify('error', '该网址格式无效，无法打开');
      return;
    }

    if (newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      window.location.assign(url);
    }
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
          openUrl(target.node, false);
          break;
        case 'open-new':
          openUrl(target.node, true);
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
    if (busy.value) {
      return;
    }
    dismissToast();
    dialogError.value = null;
    bookmarkEditor.value = {
      mode: 'create',
      defaultParentId: resolveCreateParent(parentId),
    };
  }

  function openEditBookmark(bookmark: HomepageBookmark): void {
    if (busy.value) {
      return;
    }
    dismissToast();
    dialogError.value = null;
    bookmarkEditor.value = { mode: 'edit', bookmark };
  }

  function openAddFolder(parentId?: string): void {
    if (busy.value) {
      return;
    }
    dismissToast();
    dialogError.value = null;
    folderEditor.value = {
      mode: 'create',
      defaultParentId: resolveCreateParent(parentId),
    };
  }

  function openRenameFolder(folder: HomepageFolder): void {
    if (busy.value) {
      return;
    }
    dismissToast();
    dialogError.value = null;
    folderEditor.value = { mode: 'rename', folder };
  }

  function closeBookmarkEditor(): void {
    if (busy.value) {
      return;
    }
    bookmarkEditor.value = null;
    dialogError.value = null;
  }

  function closeFolderEditor(): void {
    if (busy.value) {
      return;
    }
    folderEditor.value = null;
    dialogError.value = null;
  }

  async function saveBookmark(payload: BookmarkFormPayload): Promise<void> {
    const state = bookmarkEditor.value;
    if (!state || busy.value) {
      return;
    }

    busy.value = true;
    dialogError.value = null;

    try {
      const title = payload.title.trim();

      if (state.mode === 'create') {
        await service.createBookmark({
          parentId: payload.parentId,
          title,
          url: payload.url,
        });
        await options.refresh();
        bookmarkEditor.value = null;
        notify('success', '已新增书签');
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
        notify('success', '没有需要保存的修改');
        return;
      }

      await service.updateBookmark(state.bookmark.id, changes);
      await options.refresh();
      bookmarkEditor.value = null;
      notify('success', '已保存书签');
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      busy.value = false;
    }
  }

  async function saveFolder(payload: FolderFormPayload): Promise<void> {
    const state = folderEditor.value;
    if (!state || busy.value) {
      return;
    }

    busy.value = true;
    dialogError.value = null;

    try {
      const title = payload.title.trim();

      if (state.mode === 'create') {
        await service.createFolder({
          parentId: payload.parentId,
          title,
        });
        await options.refresh();
        folderEditor.value = null;
        notify('success', '已新建文件夹');
        return;
      }

      if (title === state.folder.title.trim()) {
        folderEditor.value = null;
        notify('success', '没有需要保存的修改');
        return;
      }

      await service.renameFolder(state.folder.id, title);
      await options.refresh();
      folderEditor.value = null;
      notify('success', '已重命名文件夹');
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      busy.value = false;
    }
  }

  function askDeleteBookmark(bookmark: HomepageBookmark): void {
    if (busy.value) {
      return;
    }
    dismissToast();
    dialogError.value = null;
    confirmDialog.value = {
      target: { kind: 'bookmark', node: bookmark },
      title: `删除书签“${getNodeTitle(bookmark)}”？`,
      message: '此操作会直接删除 Chrome 原生书签，且无法撤销。',
      warning: null,
      confirmLabel: '删除书签',
    };
  }

  function askDeleteFolder(folder: HomepageFolder): void {
    if (busy.value) {
      return;
    }

    const summary = summarizeFolderContents(folder);
    const hasChildren = summary.bookmarkCount > 0 || summary.folderCount > 0;
    const warning = hasChildren
      ? `该文件夹包含 ${summary.bookmarkCount} 个书签和 ${summary.folderCount} 个子文件夹，删除后将一并移除。`
      : '这是一个空文件夹，删除后无法恢复。';

    dismissToast();
    dialogError.value = null;
    confirmDialog.value = {
      target: { kind: 'folder', node: folder },
      title: `删除文件夹“${getNodeTitle(folder)}”？`,
      message: '删除会直接修改 Chrome 原生书签，且无法撤销。',
      warning,
      confirmLabel: '删除文件夹',
    };
  }

  function closeConfirmDialog(): void {
    if (busy.value) {
      return;
    }
    confirmDialog.value = null;
    dialogError.value = null;
  }

  async function confirmDelete(): Promise<void> {
    const state = confirmDialog.value;
    if (!state || busy.value) {
      return;
    }

    const target = state.target;
    busy.value = true;
    dialogError.value = null;

    try {
      if (target.kind === 'bookmark') {
        await service.removeBookmark(target.node.id);
      } else {
        await service.removeFolder(target.node.id);
      }

      await options.refresh();
      confirmDialog.value = null;

      if (target.kind === 'bookmark') {
        notify('success', '已删除书签');
      } else if (target.node.children.length === 0) {
        notify('success', '已删除空文件夹');
      } else {
        notify('success', '已删除文件夹及其内容');
      }
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      busy.value = false;
    }
  }

  function openMoveDialog(target: ManagedNode): void {
    if (busy.value || !homepage.value) {
      return;
    }

    const excluded =
      target.kind === 'folder'
        ? collectFolderSubtreeIds(target.node)
        : new Set<string>();
    const tree = buildFolderTree(homepage.value, excluded);

    if (tree.length === 0) {
      notify('error', '没有可用的目标文件夹');
      return;
    }

    dismissToast();
    dialogError.value = null;
    moveDialog.value = {
      target,
      tree,
      currentParentId: target.node.parentId,
    };
  }

  function closeMoveDialog(): void {
    if (busy.value) {
      return;
    }
    moveDialog.value = null;
    dialogError.value = null;
  }

  async function confirmMove(parentId: string): Promise<void> {
    const state = moveDialog.value;
    if (!state || busy.value) {
      return;
    }

    if (parentId === state.currentParentId) {
      dialogError.value = '请选择其他文件夹作为目标位置';
      return;
    }

    const siblings = getFolderChildren(homepage.value, parentId);
    if (!siblings) {
      dialogError.value = '目标文件夹已不存在，请重新选择';
      return;
    }

    const index = computeDropIndex(siblings, state.target.node.id);
    if (index === null) {
      dialogError.value = '无法计算目标位置';
      return;
    }

    busy.value = true;
    dialogError.value = null;

    try {
      if (state.target.kind === 'bookmark') {
        await service.moveBookmark(state.target.node.id, { parentId, index });
      } else {
        await service.moveFolder(state.target.node.id, { parentId, index });
      }

      await options.refresh();
      moveDialog.value = null;
      notify('success', '已移动书签');
    } catch (error) {
      dialogError.value = getErrorMessage(error);
    } finally {
      busy.value = false;
    }
  }

  function canDropIntoParent(parentId: string): boolean {
    if (!dragState.value || !homepage.value) {
      return false;
    }

    if (getFolderChildren(homepage.value, parentId) === null) {
      return false;
    }

    if (dragState.value.node.kind === 'folder') {
      const sourceIds = collectFolderSubtreeIds(dragState.value.node.node);
      if (sourceIds.has(parentId)) {
        return false;
      }
    }

    return true;
  }

  function startDrag(event: DragEvent, node: ManagedNode): void {
    if (busy.value || isProtectedSystemNodeId(node.node.id)) {
      event.preventDefault();
      return;
    }

    closeContextMenu();
    dragState.value = { node, drop: null };
    suppressClickUntil = Date.now() + 600;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(
        'application/x-bookmark-home-node',
        JSON.stringify({ id: node.node.id, kind: node.kind }),
      );
      event.dataTransfer.setData('text/plain', getNodeTitle(node.node));
    }
  }

  function endDrag(): void {
    if (!dragState.value) {
      return;
    }
    dragState.value = null;
    suppressClickUntil = Date.now() + 260;
  }

  function setDrop(drop: DropTarget | null): void {
    if (!dragState.value) {
      return;
    }
    dragState.value = { ...dragState.value, drop };
  }

  function dragOverBookmark(event: DragEvent, bookmark: HomepageBookmark): boolean {
    if (!dragState.value || busy.value) {
      return false;
    }
    if (dragState.value.node.node.id === bookmark.id) {
      return false;
    }
    if (!canDropIntoParent(bookmark.parentId)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    const element = event.currentTarget;
    const rect = element instanceof HTMLElement ? element.getBoundingClientRect() : null;
    const position =
      rect && event.clientX - rect.left > rect.width / 2 ? 'after' : 'before';

    setDrop({
      kind: 'bookmark',
      id: bookmark.id,
      parentId: bookmark.parentId,
      position,
    });
    return true;
  }

  function dragLeaveBookmark(event: DragEvent, id: string): void {
    const drop = dragState.value?.drop;
    if (!drop || drop.kind !== 'bookmark' || drop.id !== id) {
      return;
    }
    if (
      event.currentTarget instanceof Node &&
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setDrop(null);
  }

  function dropOnBookmark(event: DragEvent, bookmark: HomepageBookmark): void {
    if (!dragState.value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!dragOverBookmark(event, bookmark)) {
      return;
    }
    const drop = dragState.value.drop;
    if (drop) {
      void finishDrop(drop);
    }
  }

  function dragOverFolder(event: DragEvent, folder: HomepageFolder): boolean {
    if (!dragState.value || busy.value) {
      return false;
    }
    if (!canDropIntoParent(folder.id)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    setDrop({ kind: 'folder', id: folder.id, parentId: folder.id, position: 'inside' });
    return true;
  }

  function dragLeaveFolder(event: DragEvent, id: string): void {
    const drop = dragState.value?.drop;
    if (!drop || drop.kind !== 'folder' || drop.id !== id) {
      return;
    }
    if (
      event.currentTarget instanceof Node &&
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setDrop(null);
  }

  function dropOnFolder(event: DragEvent, folder: HomepageFolder): void {
    if (!dragState.value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!dragOverFolder(event, folder)) {
      return;
    }
    const drop = dragState.value.drop;
    if (drop) {
      void finishDrop(drop);
    }
  }

  async function finishDrop(drop: DropTarget): Promise<void> {
    const currentDrag = dragState.value;
    if (!currentDrag) {
      return;
    }

    dragState.value = null;
    suppressClickUntil = Date.now() + 300;

    const siblings = getFolderChildren(homepage.value, drop.parentId);
    if (!siblings) {
      notify('error', '目标文件夹不可用，移动未执行');
      return;
    }

    const targetId = drop.kind === 'bookmark' ? drop.id : undefined;
    const position = drop.kind === 'bookmark' ? drop.position : 'before';
    const index = computeDropIndex(siblings, currentDrag.node.node.id, targetId, position);

    if (index === null) {
      notify('error', '无法确定插入位置，移动未执行');
      return;
    }

    if (
      currentDrag.node.node.parentId === drop.parentId &&
      currentDrag.node.node.index === index
    ) {
      return;
    }

    const sameParent = currentDrag.node.node.parentId === drop.parentId;
    busy.value = true;

    try {
      if (currentDrag.node.kind === 'bookmark') {
        await service.moveBookmark(currentDrag.node.node.id, {
          parentId: drop.parentId,
          index,
        });
      } else {
        await service.moveFolder(currentDrag.node.node.id, {
          parentId: drop.parentId,
          index,
        });
      }

      await options.refresh();
      notify(
        'success',
        sameParent
          ? '已调整顺序'
          : currentDrag.node.kind === 'bookmark'
            ? '已移动书签'
            : '已移动文件夹',
      );
    } catch (error) {
      notify('error', getErrorMessage(error));
    } finally {
      busy.value = false;
    }
  }

  function isBookmarkDropBefore(id: string): boolean {
    const drop = dragState.value?.drop;
    return drop?.kind === 'bookmark' && drop.id === id && drop.position === 'before';
  }

  function isBookmarkDropAfter(id: string): boolean {
    const drop = dragState.value?.drop;
    return drop?.kind === 'bookmark' && drop.id === id && drop.position === 'after';
  }

  function isFolderDropTarget(id: string): boolean {
    const drop = dragState.value?.drop;
    return drop?.kind === 'folder' && drop.id === id;
  }

  function isDraggingNode(id: string): boolean {
    return dragState.value?.node.node.id === id;
  }

  function shouldSuppressClick(event: MouseEvent): boolean {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  }

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
    dialogError,
    bookmarkEditor,
    folderEditor,
    confirmDialog,
    moveDialog,
    contextMenu,
    toast,
    dragState,
    folderOptions,

    // 菜单
    openBookmarkContextMenu,
    openBookmarkMenuAt,
    openFolderContextMenu,
    openFolderMenuAt,
    openAddMenu,
    handleContextAction,
    closeContextMenu,

    // 表单与确认
    openAddBookmark,
    openEditBookmark,
    openAddFolder,
    openRenameFolder,
    closeBookmarkEditor,
    closeFolderEditor,
    closeConfirmDialog,
    closeMoveDialog,
    saveBookmark,
    saveFolder,
    confirmDelete,
    confirmMove,
    askDeleteBookmark,
    askDeleteFolder,
    openMoveDialog,

    // 拖拽
    startDrag,
    endDrag,
    dragOverBookmark,
    dragLeaveBookmark,
    dropOnBookmark,
    dragOverFolder,
    dragLeaveFolder,
    dropOnFolder,
    isBookmarkDropBefore,
    isBookmarkDropAfter,
    isFolderDropTarget,
    isDraggingNode,
    shouldSuppressClick,

    // 反馈
    notify,
    dismissToast,
  };
}
