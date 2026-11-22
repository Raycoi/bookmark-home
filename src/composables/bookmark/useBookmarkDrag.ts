import { shallowRef, type Ref } from 'vue';
import type { BookmarkService } from '../../services/bookmarkService';
import {
  isProtectedSystemNodeId,
  type HomepageBookmark,
  type HomepageData,
  type HomepageFolder,
} from '../../types/bookmark';
import type {
  DragState,
  DropTarget,
  ManagedNode,
} from '../../types/management';
import { computeDropIndex } from '../../utils/dragMove';
import { getErrorMessage } from '../../utils/errors';
import {
  collectFolderSubtreeIds,
  getFolderChildren,
  getNodeTitle,
} from '../../utils/folders';
import { t } from '../../i18n';
import type { Notify } from './types';

export interface UseBookmarkDragOptions {
  data: Ref<HomepageData | null>;
  service: BookmarkService;
  refresh: () => Promise<void>;
  busy: Ref<boolean>;
  notify: Notify;
  /** 开始拖拽时关闭已打开的右键菜单，避免菜单悬浮在拖拽动画之上。 */
  closeContextMenu: () => void;
}

/**
 * 拖拽状态机：只负责拖拽会话、放置目标与最终 move 调用。
 *
 * - 保护 Chrome 系统节点，禁止拖起；
 * - 拒绝拖入自身或自身子树；
 * - 同父级且位置不变时不发起多余的 move；
 * - 拖拽结束后的短暂点击抑制由 shouldSuppressClick 统一判定。
 */
export function useBookmarkDrag(options: UseBookmarkDragOptions) {
  const dragState = shallowRef<DragState | null>(null);
  let suppressClickUntil = 0;

  function canDropIntoParent(parentId: string): boolean {
    if (!dragState.value || !options.data.value) {
      return false;
    }

    if (getFolderChildren(options.data.value, parentId) === null) {
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
    if (options.busy.value || isProtectedSystemNodeId(node.node.id)) {
      event.preventDefault();
      return;
    }

    options.closeContextMenu();
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

  function dragOverBookmark(
    event: DragEvent,
    bookmark: HomepageBookmark,
  ): boolean {
    if (!dragState.value || options.busy.value) {
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
    const rect =
      element instanceof HTMLElement ? element.getBoundingClientRect() : null;
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
    if (!dragState.value || options.busy.value) {
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

    setDrop({
      kind: 'folder',
      id: folder.id,
      parentId: folder.id,
      position: 'inside',
    });
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

    const siblings = getFolderChildren(options.data.value, drop.parentId);
    if (!siblings) {
      options.notify('error', t('manager.dropDestinationUnavailable'));
      return;
    }

    const targetId = drop.kind === 'bookmark' ? drop.id : undefined;
    const position = drop.kind === 'bookmark' ? drop.position : 'before';
    const index = computeDropIndex(
      siblings,
      currentDrag.node.node.id,
      targetId,
      position,
    );

    if (index === null) {
      options.notify('error', t('manager.dropPositionUnknown'));
      return;
    }

    if (
      currentDrag.node.node.parentId === drop.parentId &&
      currentDrag.node.node.index === index
    ) {
      return;
    }

    const sameParent = currentDrag.node.node.parentId === drop.parentId;
    options.busy.value = true;

    try {
      if (currentDrag.node.kind === 'bookmark') {
        await options.service.moveBookmark(currentDrag.node.node.id, {
          parentId: drop.parentId,
          index,
        });
      } else {
        await options.service.moveFolder(currentDrag.node.node.id, {
          parentId: drop.parentId,
          index,
        });
      }

      await options.refresh();
      options.notify(
        'success',
        sameParent
          ? t('manager.reordered')
          : currentDrag.node.kind === 'bookmark'
            ? t('manager.bookmarkMoved')
            : t('manager.folderMoved'),
      );
    } catch (error) {
      options.notify('error', getErrorMessage(error));
    } finally {
      options.busy.value = false;
    }
  }

  function isBookmarkDropBefore(id: string): boolean {
    const drop = dragState.value?.drop;
    return (
      drop?.kind === 'bookmark' && drop.id === id && drop.position === 'before'
    );
  }

  function isBookmarkDropAfter(id: string): boolean {
    const drop = dragState.value?.drop;
    return (
      drop?.kind === 'bookmark' && drop.id === id && drop.position === 'after'
    );
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

  return {
    dragState,
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
  };
}
