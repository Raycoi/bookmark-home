import {
  BOOKMARKS_BAR_ID,
  OTHER_BOOKMARKS_ID,
  PERMANENT_FOLDER_ROLES,
  SYSTEM_ROOT_ID,
  type BookmarkTreeSummary,
  type HomepageBookmark,
  type HomepageData,
  type HomepageFolder,
  type HomepageNode,
  type HomepageSection,
  type HomepageSectionRole,
  type NativeBookmarkNode,
  type PermanentFolderRole,
} from '../types/bookmark';
import { t } from '../i18n';

const ROLE_BY_NODE_ID: Readonly<Record<string, PermanentFolderRole>> = PERMANENT_FOLDER_ROLES;
const ROLE_BY_ROOT_ORDINAL: readonly PermanentFolderRole[] = [
  'bookmarks-bar',
  'other-bookmarks',
  'mobile-bookmarks',
];

/** 原生书签树缺少永久目录标题时的回退文案（随语言切换）。 */
function fallbackSectionTitle(role: PermanentFolderRole): string {
  switch (role) {
    case 'bookmarks-bar':
      return t('bookmark.section.bookmarksBar');
    case 'other-bookmarks':
      return t('bookmark.section.otherBookmarks');
    case 'mobile-bookmarks':
      return t('bookmark.section.mobileBookmarks');
  }
}

/** 书签树结构不符合 Chrome 约定时抛出的错误。 */
export class BookmarkTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookmarkTreeError';
  }
}

/**
 * 把 Chrome 原生书签树转换为主页展示模型。
 *
 * 转换是只读的：
 * - 不发起任何书签写操作；
 * - 不缓存第二份持久化数据；
 * - 只保留原生 children 顺序（同时兼容 index 缺失的测试数据）。
 */
export function transformBookmarkTree(tree: readonly NativeBookmarkNode[]): HomepageData {
  if (!Array.isArray(tree)) {
    throw new BookmarkTreeError(t('bookmark.error.treeInvalid'));
  }

  if (tree.length === 0) {
    return createEmptyHomepageData();
  }

  if (tree.length > 1) {
    throw new BookmarkTreeError(t('bookmark.error.treeMultipleRoots'));
  }

  const root = tree[0];
  if (!root) {
    return createEmptyHomepageData();
  }

  if (typeof root.url === 'string') {
    throw new BookmarkTreeError(t('bookmark.error.treeRootUrl'));
  }

  const rootChildren = sortNativeChildren(root.children);
  // 只有整组根节点都不带 Chrome 固定 ID 时，才按顺序兼容识别三个区域。
  // 否则未知的额外根节点不能被误判成“移动设备书签”。
  const allowOrdinalFallback = !rootChildren.some((child) => ROLE_BY_NODE_ID[child.id]);
  let bookmarksBar: HomepageSection | undefined;
  let otherBookmarks: HomepageSection | undefined;
  let mobileBookmarks: HomepageSection | undefined;
  const extraSections: HomepageSection[] = [];

  rootChildren.forEach((child, ordinal) => {
    if (typeof child.url === 'string') {
      throw new BookmarkTreeError(t('bookmark.error.treeRootChildUrl'));
    }

    const role = resolveRootChildRole(child, ordinal, allowOrdinalFallback);
    const section = buildSection(child, role ?? 'unknown', ordinal);

    switch (role) {
      case 'bookmarks-bar':
        if (bookmarksBar) {
          extraSections.push({ ...section, role: 'unknown' });
        } else {
          bookmarksBar = section;
        }
        break;
      case 'other-bookmarks':
        if (otherBookmarks) {
          extraSections.push({ ...section, role: 'unknown' });
        } else {
          otherBookmarks = section;
        }
        break;
      case 'mobile-bookmarks':
        if (mobileBookmarks) {
          extraSections.push({ ...section, role: 'unknown' });
        } else {
          mobileBookmarks = section;
        }
        break;
      default:
        extraSections.push({ ...section, role: 'unknown' });
    }
  });

  const resolvedBar =
    bookmarksBar ??
    createEmptySection(
      'bookmarks-bar',
      BOOKMARKS_BAR_ID,
      fallbackSectionTitle('bookmarks-bar'),
      0,
    );
  const resolvedOther =
    otherBookmarks ??
    createEmptySection(
      'other-bookmarks',
      OTHER_BOOKMARKS_ID,
      fallbackSectionTitle('other-bookmarks'),
      1,
    );

  const sections = [
    resolvedBar,
    resolvedOther,
    ...(mobileBookmarks ? [mobileBookmarks] : []),
    ...extraSections,
  ];

  return {
    root: {
      id: root.id,
      title: root.title ?? '',
    },
    bookmarksBar: resolvedBar,
    otherBookmarks: resolvedOther,
    mobileBookmarks: mobileBookmarks ?? null,
    extraSections,
    summary: summarizeSections(sections),
  };
}

/** 空书签树的安全展示模型。 */
export function createEmptyHomepageData(): HomepageData {
  const bookmarksBar = createEmptySection(
    'bookmarks-bar',
    BOOKMARKS_BAR_ID,
    fallbackSectionTitle('bookmarks-bar'),
    0,
  );
  const otherBookmarks = createEmptySection(
    'other-bookmarks',
    OTHER_BOOKMARKS_ID,
    fallbackSectionTitle('other-bookmarks'),
    1,
  );

  return {
    root: { id: SYSTEM_ROOT_ID, title: '' },
    bookmarksBar,
    otherBookmarks,
    mobileBookmarks: null,
    extraSections: [],
    summary: summarizeSections([bookmarksBar, otherBookmarks]),
  };
}

function resolveRootChildRole(
  node: NativeBookmarkNode,
  ordinal: number,
  allowOrdinalFallback: boolean,
): PermanentFolderRole | undefined {
  return (
    ROLE_BY_NODE_ID[node.id] ??
    (allowOrdinalFallback ? ROLE_BY_ROOT_ORDINAL[ordinal] : undefined)
  );
}

function buildSection(
  node: NativeBookmarkNode,
  role: HomepageSectionRole,
  position: number,
): HomepageSection {
  const folder = toHomepageFolder(node, position);
  return {
    ...folder,
    role,
    directBookmarks: folder.children.filter(isHomepageBookmark),
    folders: folder.children.filter(isHomepageFolder),
  };
}

function toHomepageNode(node: NativeBookmarkNode, position: number): HomepageNode {
  if (typeof node.url === 'string') {
    return toHomepageBookmark(node, position);
  }

  return toHomepageFolder(node, position);
}

function toHomepageBookmark(node: NativeBookmarkNode, position: number): HomepageBookmark {
  return {
    type: 'bookmark',
    id: node.id,
    parentId: node.parentId ?? '',
    title: node.title ?? '',
    url: node.url ?? '',
    index: resolveIndex(node, position),
  };
}

function toHomepageFolder(node: NativeBookmarkNode, position: number): HomepageFolder {
  const children = sortNativeChildren(node.children).map((child, childPosition) =>
    toHomepageNode(child, childPosition),
  );

  return {
    type: 'folder',
    id: node.id,
    parentId: node.parentId ?? '',
    title: node.title ?? '',
    index: resolveIndex(node, position),
    children,
  };
}

function createEmptySection(
  role: PermanentFolderRole,
  id: string,
  title: string,
  position: number,
): HomepageSection {
  return {
    type: 'folder',
    id,
    parentId: SYSTEM_ROOT_ID,
    title,
    index: position,
    children: [],
    role,
    directBookmarks: [],
    folders: [],
  };
}

function sortNativeChildren(children: readonly NativeBookmarkNode[] | undefined): NativeBookmarkNode[] {
  if (!children || children.length === 0) {
    return [];
  }

  return children
    .map((node, position) => ({
      node,
      position,
      order: resolveIndex(node, position),
    }))
    .sort((left, right) => left.order - right.order || left.position - right.position)
    .map((item) => item.node);
}

function resolveIndex(node: NativeBookmarkNode, fallback: number): number {
  return typeof node.index === 'number' && Number.isInteger(node.index) && node.index >= 0
    ? node.index
    : fallback;
}

function isHomepageBookmark(node: HomepageNode): node is HomepageBookmark {
  return node.type === 'bookmark';
}

function isHomepageFolder(node: HomepageNode): node is HomepageFolder {
  return node.type === 'folder';
}

function summarizeSections(sections: readonly HomepageSection[]): BookmarkTreeSummary {
  let bookmarkCount = 0;
  let folderCount = 0;

  const visit = (nodes: readonly HomepageNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'bookmark') {
        bookmarkCount += 1;
      } else {
        folderCount += 1;
        visit(node.children);
      }
    }
  };

  sections.forEach((section) => visit(section.children));

  return {
    bookmarkCount,
    folderCount,
    sectionCount: sections.length,
  };
}
