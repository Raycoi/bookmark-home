import { computed, ref, watch, type Ref } from 'vue';
import type {
  HomepageBookmark,
  HomepageData,
  HomepageFolder,
} from '../../types/bookmark';
import type { ManagedNode } from '../../types/management';
import {
  collectFolderSubtreeIds,
  findHomepageBookmark,
  findHomepageFolder,
} from '../../utils/folders';

export interface UseBookmarkSelectionOptions {
  data: Ref<HomepageData | null>;
  /** 写操作进行中时禁止进入选择模式，避免选中正在变化的树。 */
  isBusy: () => boolean;
  /** 进入选择模式后的额外副作用（例如关闭已有 toast）。 */
  onEnterSelection?: () => void;
}

/**
 * 主页书签的多选状态机。
 *
 * - 只维护当前页面的选择集合，不读写原生书签；
 * - 选中项每次按展示树实时解析，树刷新后不会残留已消失的节点；
 * - 顺序由 setSelectionOrder 注入，Shift 范围按展示顺序计算。
 */
export function useBookmarkSelection(options: UseBookmarkSelectionOptions) {
  const selectionMode = ref(false);
  const selectedIds = ref<Set<string>>(new Set());
  const selectionOrder = ref<string[]>([]);
  const selectionAnchor = ref<string | null>(null);

  const selectedCount = computed(() => selectedIds.value.size);

  const selectedNodes = computed<ManagedNode[]>(() =>
    [...selectedIds.value].flatMap((id): ManagedNode[] => {
      const bookmark = findHomepageBookmark(options.data.value, id);
      if (bookmark) {
        return [{ kind: 'bookmark', node: bookmark }];
      }
      const folder = findHomepageFolder(options.data.value, id);
      return folder ? [{ kind: 'folder', node: folder }] : [];
    }),
  );

  const selectedBookmarks = computed<HomepageBookmark[]>(() =>
    selectedNodes.value
      .filter((target) => target.kind === 'bookmark')
      .map((target) => target.node as HomepageBookmark),
  );

  /** 去掉被选中文件夹包含的后代，避免移动/删除重复执行。 */
  function topLevelSelectedNodes(): ManagedNode[] {
    const selectedFolders = selectedNodes.value.filter(
      (target): target is { kind: 'folder'; node: HomepageFolder } =>
        target.kind === 'folder',
    );
    const descendantIds = new Set<string>();
    for (const target of selectedFolders) {
      for (const id of collectFolderSubtreeIds(target.node)) {
        if (id !== target.node.id) {
          descendantIds.add(id);
        }
      }
    }
    return selectedNodes.value.filter((target) => !descendantIds.has(target.node.id));
  }

  function enterSelection(): void {
    if (options.isBusy()) {
      return;
    }
    selectionMode.value = true;
    selectedIds.value = new Set();
    selectionAnchor.value = null;
    options.onEnterSelection?.();
  }

  function exitSelection(): void {
    selectionMode.value = false;
    selectedIds.value = new Set();
    selectionAnchor.value = null;
  }

  function setSelectionOrder(ids: readonly string[]): void {
    selectionOrder.value = [...ids];
  }

  function toggleSelection(id: string, shiftKey = false): void {
    if (!selectionMode.value) {
      return;
    }

    if (shiftKey && selectionAnchor.value) {
      const from = selectionOrder.value.indexOf(selectionAnchor.value);
      const to = selectionOrder.value.indexOf(id);
      if (from !== -1 && to !== -1) {
        const start = Math.min(from, to);
        const end = Math.max(from, to);
        selectedIds.value = new Set(selectionOrder.value.slice(start, end + 1));
        return;
      }
    }

    const next = new Set(selectedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds.value = next;
    selectionAnchor.value = id;
  }

  function selectBookmarkIds(ids: readonly string[]): void {
    if (!selectionMode.value) {
      return;
    }
    selectedIds.value = new Set(ids);
    selectionAnchor.value = null;
  }

  watch(options.data, () => {
    if (selectionMode.value) {
      exitSelection();
    }
  });

  return {
    selectionMode,
    selectedIds,
    selectedCount,
    selectedNodes,
    selectedBookmarks,
    topLevelSelectedNodes,
    enterSelection,
    exitSelection,
    setSelectionOrder,
    toggleSelection,
    selectBookmarkIds,
  };
}
