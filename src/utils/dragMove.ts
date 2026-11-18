import type { HomepageNode } from '../types/bookmark';

export type DropPosition = 'before' | 'after';

/**
 * 计算拖放后应传给 chrome.bookmarks.move 的最终 index。
 *
 * 关键点：
 * - siblings 必须是目标文件夹当前的原生顺序（展示模型已按原生 index 排序）；
 * - 同父级拖动时先排除源节点，再定位目标；
 * - 返回的是“移动完成后”的位置，Chrome API 按最终位置解释 index。
 */
export function computeDropIndex(
  siblings: readonly HomepageNode[],
  sourceId: string,
  targetId?: string,
  position: DropPosition = 'before',
): number | null {
  const withoutSource = siblings.filter((node) => node.id !== sourceId);

  if (targetId === undefined) {
    return withoutSource.length;
  }

  const targetIndex = withoutSource.findIndex((node) => node.id === targetId);
  if (targetIndex === -1) {
    return null;
  }

  return position === 'after' ? targetIndex + 1 : targetIndex;
}
