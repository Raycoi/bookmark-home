/** 本地书签搜索结果。 */
export interface SearchableBookmark {
  id: string;
  parentId: string;
  title: string;
  url: string;
  folderPath: string;
  sectionTitle: string;
}

/** 最近从新标签页打开的书签；只保存在本地扩展存储。 */
export interface RecentBookmark {
  id: string;
  title: string;
  url: string;
  folderPath: string;
  openedAt: number;
}
