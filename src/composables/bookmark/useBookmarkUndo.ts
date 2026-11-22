import type { Ref } from 'vue';
import type { BookmarkService } from '../../services/bookmarkService';
import {
  OTHER_BOOKMARKS_ID,
  type HomepageData,
  type HomepageNode,
} from '../../types/bookmark';
import type { ManagedNode } from '../../types/management';
import { getFolderChildren } from '../../utils/folders';
import { getErrorMessage } from '../../utils/errors';
import { t } from '../../i18n';
import type { Notify } from './types';

/** 删除前快照：记录被删节点与原始父文件夹，用于撤销重建。 */
export interface DeleteSnapshot {
  target: ManagedNode;
  parentId: string;
}

export interface UseBookmarkUndoOptions {
  data: Ref<HomepageData | null>;
  service: BookmarkService;
  refresh: () => Promise<void>;
  busy: Ref<boolean>;
  notify: Notify;
  exitSelection: () => void;
}

/**
 * 删除撤销：单条删除与批量删除共用同一套快照重建逻辑。
 *
 * - 快照在删除前生成，包含节点本身与原始父文件夹；
 * - 原父文件夹已不存在时回退到“其他书签”；
 * - 文件夹按原 index 重建后递归恢复后代。
 */
export function useBookmarkUndo(options: UseBookmarkUndoOptions) {
  async function restoreNode(
    node: HomepageNode,
    parentId: string,
    index?: number,
  ): Promise<void> {
    if (node.type === 'bookmark') {
      await options.service.createBookmark({
        parentId,
        title: node.title,
        url: node.url,
        ...(index === undefined ? {} : { index }),
      });
      return;
    }

    const folder = await options.service.createFolder({
      parentId,
      title: node.title,
      ...(index === undefined ? {} : { index }),
    });
    for (const child of node.children) {
      await restoreNode(child, folder.id, child.index);
    }
  }

  interface RestoreTarget {
    parentId: string;
    index: number | undefined;
    originalParentExists: boolean;
  }

  function resolveRestoreTarget(snapshot: DeleteSnapshot): RestoreTarget {
    const originalParentExists =
      getFolderChildren(options.data.value, snapshot.parentId) !== null;
    return {
      parentId: originalParentExists
        ? snapshot.parentId
        : OTHER_BOOKMARKS_ID,
      index: originalParentExists ? snapshot.target.node.index : undefined,
      originalParentExists,
    };
  }

  async function restoreDeleted(snapshot: DeleteSnapshot): Promise<void> {
    if (options.busy.value) {
      return;
    }

    const { parentId, index, originalParentExists } =
      resolveRestoreTarget(snapshot);

    options.busy.value = true;
    try {
      await restoreNode(snapshot.target.node, parentId, index);
      await options.refresh();
      options.notify(
        'success',
        originalParentExists
          ? t('manager.deleteUndone')
          : t('manager.deleteUndoneToOther'),
      );
    } catch (error) {
      options.notify(
        'error',
        t('manager.undoFailed', { message: getErrorMessage(error) }),
      );
    } finally {
      options.busy.value = false;
    }
  }

  function notifyDeleted(snapshot: DeleteSnapshot, message: string): void {
    options.notify('success', message, {
      actionLabel: t('manager.undo'),
      timeoutMs: 8000,
      action: () => restoreDeleted(snapshot),
    });
  }

  async function restoreDeletedMany(
    snapshots: DeleteSnapshot[],
  ): Promise<void> {
    if (options.busy.value || snapshots.length === 0) {
      return;
    }

    options.busy.value = true;
    try {
      for (const snapshot of snapshots) {
        const { parentId, index } = resolveRestoreTarget(snapshot);
        await restoreNode(snapshot.target.node, parentId, index);
      }
      await options.refresh();
      options.exitSelection();
      options.notify('success', t('manager.bulkDeleteUndone'));
    } catch (error) {
      options.notify(
        'error',
        t('manager.undoFailed', { message: getErrorMessage(error) }),
      );
    } finally {
      options.busy.value = false;
    }
  }

  function notifyBulkDeleted(snapshots: DeleteSnapshot[]): void {
    options.notify(
      'success',
      t('manager.bulkDeleted', { count: snapshots.length }),
      {
        actionLabel: t('manager.undo'),
        timeoutMs: 8000,
        action: () => restoreDeletedMany(snapshots),
      },
    );
  }

  return {
    notifyDeleted,
    notifyBulkDeleted,
  };
}
