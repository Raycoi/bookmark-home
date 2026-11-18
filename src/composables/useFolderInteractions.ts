import { computed, type Ref } from 'vue';
import { useBookmarkManagerContext } from './useBookmarkManager';
import type { HomepageFolder } from '../types/bookmark';

/**
 * 文件夹标题/区域的菜单与拖拽委托。
 *
 * BookmarkFolder、BookmarkGroup、OtherBookmarks 共用同一套交互，
 * 避免三处分别维护拖拽事件和菜单打开逻辑。
 */
export function useFolderInteractions(
  getFolder: () => HomepageFolder,
  moreButton: Ref<HTMLButtonElement | null>,
) {
  const manager = useBookmarkManagerContext();

  const isBusy = computed(() => manager?.busy.value ?? false);
  const isDragging = computed(
    () => manager?.isDraggingNode(getFolder().id) ?? false,
  );
  const isDropTarget = computed(
    () => manager?.isFolderDropTarget(getFolder().id) ?? false,
  );

  function openMenu(): void {
    if (!manager || !moreButton.value) {
      return;
    }
    manager.openFolderMenuAt(moreButton.value, getFolder());
  }

  function onContextMenu(event: MouseEvent): void {
    manager?.openFolderContextMenu(event, getFolder());
  }

  function onDragStart(event: DragEvent): void {
    if (!manager) {
      event.preventDefault();
      return;
    }
    manager.startDrag(event, { kind: 'folder', node: getFolder() });
  }

  function onDragEnd(): void {
    manager?.endDrag();
  }

  function onDragOver(event: DragEvent): void {
    manager?.dragOverFolder(event, getFolder());
  }

  function onDragLeave(event: DragEvent): void {
    manager?.dragLeaveFolder(event, getFolder().id);
  }

  function onDrop(event: DragEvent): void {
    manager?.dropOnFolder(event, getFolder());
  }

  return {
    manager,
    isBusy,
    isDragging,
    isDropTarget,
    openMenu,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
