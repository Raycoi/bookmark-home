import type {
  HomepageBookmark,
  HomepageData,
  HomepageFolder,
  HomepageNode,
  HomepageSection,
} from '../types/bookmark';
import { countBookmarks } from './bookmarkCounts';
import { t } from '../i18n';

export interface FolderOption {
  id: string;
  title: string;
  isSection: boolean;
  children: FolderOption[];
}

export interface FlatFolderOption extends FolderOption {
  depth: number;
}

export interface FolderContentSummary {
  bookmarkCount: number;
  folderCount: number;
}

/**
 * 从主页展示模型构建“只包含文件夹”的目标树。
 *
 * - 包含书签栏和其他书签两个根目录；
 * - 不包含网址节点；
 * - 可通过 excludeIds 移除源文件夹及其全部后代，防止循环移动。
 */
export function buildFolderTree(
  data: HomepageData | null,
  excludeIds: ReadonlySet<string> = new Set(),
): FolderOption[] {
  if (!data) {
    return [];
  }

  const roots: FolderOption[] = [];
  for (const section of [data.bookmarksBar, data.otherBookmarks]) {
    const option = toFolderOption(section, excludeIds, true);
    if (option) {
      roots.push(option);
    }
  }
  return roots;
}

function toFolderOption(
  folder: HomepageFolder,
  excludeIds: ReadonlySet<string>,
  isSection: boolean,
): FolderOption | null {
  if (excludeIds.has(folder.id)) {
    return null;
  }

  const children = folder.children
    .filter((node): node is HomepageFolder => node.type === 'folder')
    .map((child) => toFolderOption(child, excludeIds, false))
    .filter((child): child is FolderOption => child !== null);

  return {
    id: folder.id,
    title: folder.title.trim() || t('common.unnamedFolder'),
    isSection,
    children,
  };
}

/** 展平文件夹树，供表单中的保存位置下拉框使用。 */
export function flattenFolderOptions(
  tree: readonly FolderOption[],
  depth = 0,
): FlatFolderOption[] {
  const result: FlatFolderOption[] = [];
  for (const option of tree) {
    result.push({ ...option, depth });
    result.push(...flattenFolderOptions(option.children, depth + 1));
  }
  return result;
}

/** 生成带层级缩进的下拉框文字。 */
export function formatFolderOption(option: FlatFolderOption): string {
  return `${'　'.repeat(option.depth)}${option.title}`;
}

/** 收集文件夹自身及全部后代文件夹 ID（网址不参与）。 */
export function collectFolderSubtreeIds(folder: HomepageFolder): Set<string> {
  const ids = new Set<string>();

  const visit = (current: HomepageFolder): void => {
    ids.add(current.id);
    for (const child of current.children) {
      if (child.type === 'folder') {
        visit(child);
      }
    }
  };

  visit(folder);
  return ids;
}

/** 查找某个文件夹的直接子节点，用于计算拖放后的原生 index。 */
export function getFolderChildren(
  data: HomepageData | null,
  folderId: string,
): HomepageNode[] | null {
  if (!data) {
    return null;
  }

  const sections: HomepageSection[] = [
    data.bookmarksBar,
    data.otherBookmarks,
    ...(data.mobileBookmarks ? [data.mobileBookmarks] : []),
    ...data.extraSections,
  ];

  for (const section of sections) {
    const found = findChildren(section, folderId);
    if (found) {
      return found;
    }
  }

  return null;
}

function findChildren(folder: HomepageFolder, folderId: string): HomepageNode[] | null {
  if (folder.id === folderId) {
    return folder.children;
  }

  for (const child of folder.children) {
    if (child.type !== 'folder') {
      continue;
    }
    const found = findChildren(child, folderId);
    if (found) {
      return found;
    }
  }

  return null;
}

/** 在完整主页树中按 ID 找到网址书签。 */
export function findHomepageBookmark(
  data: HomepageData | null,
  bookmarkId: string,
): HomepageBookmark | null {
  if (!data) {
    return null;
  }

  const sections: HomepageSection[] = [
    data.bookmarksBar,
    data.otherBookmarks,
    ...(data.mobileBookmarks ? [data.mobileBookmarks] : []),
    ...data.extraSections,
  ];

  for (const section of sections) {
    const found = findBookmark(section, bookmarkId);
    if (found) {
      return found;
    }
  }

  return null;
}

function findBookmark(
  folder: HomepageFolder,
  bookmarkId: string,
): HomepageBookmark | null {
  for (const child of folder.children) {
    if (child.type === 'bookmark') {
      if (child.id === bookmarkId) {
        return child;
      }
      continue;
    }
    const found = findBookmark(child, bookmarkId);
    if (found) {
      return found;
    }
  }

  return null;
}

/** 统计文件夹内全部后代书签和子文件夹数量。 */
export function summarizeFolderContents(folder: HomepageFolder): FolderContentSummary {
  let folderCount = 0;

  const visit = (nodes: readonly HomepageNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        folderCount += 1;
        visit(node.children);
      }
    }
  };

  visit(folder.children);

  return {
    bookmarkCount: countBookmarks(folder.children),
    folderCount,
  };
}

/** 取得文件夹或网址的展示名称。 */
export function getNodeTitle(node: HomepageFolder | HomepageNode): string {
  return (
    node.title.trim() ||
    (node.type === 'folder'
      ? t('common.unnamedFolder')
      : t('common.unnamedBookmark'))
  );
}

/** 收集可用于多选的文件夹和书签，按主页展示顺序排列。 */
export function collectSelectableIds(data: HomepageData | null): string[] {
  if (!data) {
    return [];
  }
  const ids: string[] = [];
  const visit = (folder: HomepageFolder, includeFolder: boolean): void => {
    if (includeFolder) {
      ids.push(folder.id);
    }
    for (const child of folder.children) {
      if (child.type === 'bookmark') {
        ids.push(child.id);
      } else {
        visit(child, true);
      }
    }
  };
  for (const section of [
    data.bookmarksBar,
    ...(data.mobileBookmarks ? [data.mobileBookmarks] : []),
    ...data.extraSections,
    data.otherBookmarks,
  ]) {
    for (const child of section.children) {
      if (child.type === 'bookmark') {
        ids.push(child.id);
      } else {
        visit(child, true);
      }
    }
  }
  return ids;
}

/** 按 ID 找到文件夹。 */
export function findHomepageFolder(
  data: HomepageData | null,
  folderId: string,
): HomepageFolder | null {
  if (!data) {
    return null;
  }
  const sections: HomepageSection[] = [
    data.bookmarksBar,
    data.otherBookmarks,
    ...(data.mobileBookmarks ? [data.mobileBookmarks] : []),
    ...data.extraSections,
  ];
  const visit = (folder: HomepageFolder): HomepageFolder | null => {
    if (folder.id === folderId) {
      return folder;
    }
    for (const child of folder.children) {
      if (child.type === 'folder') {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  for (const section of sections) {
    const found = visit(section);
    if (found) {
      return found;
    }
  }
  return null;
}