/**
 * Chrome 原生书签节点。
 *
 * 该类型只描述本扩展实际读取的字段，结构与
 * chrome.bookmarks.BookmarkTreeNode 兼容，便于适配层做纯函数测试。
 * 适配层不会修改原生节点。
 */
export interface NativeBookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  dateAdded?: number;
  dateGroupModified?: number;
  unmodifiable?: string;
  children?: NativeBookmarkNode[];
}

/** Chrome 书签栏、其他书签、移动设备书签的固定节点 ID。 */
export const BOOKMARKS_BAR_ID = '1';
export const OTHER_BOOKMARKS_ID = '2';
export const MOBILE_BOOKMARKS_ID = '3';
export const SYSTEM_ROOT_ID = '0';

/** 不允许通过扩展删除、移动或重命名的 Chrome 系统节点。 */
export const PROTECTED_SYSTEM_NODE_IDS: readonly string[] = [
  SYSTEM_ROOT_ID,
  BOOKMARKS_BAR_ID,
  OTHER_BOOKMARKS_ID,
  MOBILE_BOOKMARKS_ID,
];

export function isProtectedSystemNodeId(id: string): boolean {
  return PROTECTED_SYSTEM_NODE_IDS.includes(id);
}

export const PERMANENT_FOLDER_ROLES = {
  [BOOKMARKS_BAR_ID]: 'bookmarks-bar',
  [OTHER_BOOKMARKS_ID]: 'other-bookmarks',
  [MOBILE_BOOKMARKS_ID]: 'mobile-bookmarks',
} as const;

export type PermanentFolderRole = (typeof PERMANENT_FOLDER_ROLES)[keyof typeof PERMANENT_FOLDER_ROLES];
export type HomepageSectionRole = PermanentFolderRole | 'unknown';

/** 主页展示模型中的网址书签。 */
export interface HomepageBookmark {
  type: 'bookmark';
  id: string;
  parentId: string;
  title: string;
  url: string;
  index: number;
}

/** 主页展示模型中的文件夹，保留原生层级与排序。 */
export interface HomepageFolder {
  type: 'folder';
  id: string;
  parentId: string;
  title: string;
  index: number;
  children: HomepageNode[];
}

export type HomepageNode = HomepageBookmark | HomepageFolder;

/** 书签栏 / 其他书签等顶层区域。 */
export interface HomepageSection extends HomepageFolder {
  role: HomepageSectionRole;
  /** 直接放在该区域根部的网址，常用于首屏“常用网站”。 */
  directBookmarks: HomepageBookmark[];
  /** 直接放在该区域根部的文件夹，用于生成分类区域。 */
  folders: HomepageFolder[];
}

export interface BookmarkTreeSummary {
  bookmarkCount: number;
  folderCount: number;
  sectionCount: number;
}

/** 展示模型；它不是书签的第二份持久化数据，只存在于当前页面内存中。 */
export interface HomepageData {
  root: {
    id: string;
    title: string;
  };
  bookmarksBar: HomepageSection;
  otherBookmarks: HomepageSection;
  mobileBookmarks: HomepageSection | null;
  extraSections: HomepageSection[];
  summary: BookmarkTreeSummary;
}
