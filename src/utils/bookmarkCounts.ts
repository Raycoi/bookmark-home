import type { HomepageNode } from '../types/bookmark';

/** 统计任意书签节点集合中的网址数量（不包含文件夹本身）。 */
export function countBookmarks(nodes: readonly HomepageNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === 'bookmark') {
      return total + 1;
    }
    return total + countBookmarks(node.children);
  }, 0);
}
