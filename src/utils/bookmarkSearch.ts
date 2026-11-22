import type { HomepageData, HomepageFolder, HomepageSection } from '../types/bookmark';
import type { SearchableBookmark } from '../types/search';
import { getNavigableUrl } from './navigation';
import { t } from '../i18n';

/**
 * 展开所有区域中的可导航书签，并保留所在区域/文件夹路径。
 * 只读展示模型，不建立第二份书签数据。
 */
export function collectSearchableBookmarks(
  data: HomepageData | null,
): SearchableBookmark[] {
  if (!data) {
    return [];
  }

  const sections: HomepageSection[] = [
    data.bookmarksBar,
    data.otherBookmarks,
    ...(data.mobileBookmarks ? [data.mobileBookmarks] : []),
    ...data.extraSections,
  ];
  const result: SearchableBookmark[] = [];

  for (const section of sections) {
    const sectionTitle = section.title.trim() || t('common.unnamedSection');
    visitFolder(section, sectionTitle, sectionTitle, result);
  }

  return result;
}

function visitFolder(
  folder: HomepageFolder,
  path: string,
  sectionTitle: string,
  result: SearchableBookmark[],
): void {
  for (const child of folder.children) {
    if (child.type === 'folder') {
      const title = child.title.trim() || t('common.unnamedFolder');
      visitFolder(child, `${path} / ${title}`, sectionTitle, result);
      continue;
    }

    if (!getNavigableUrl(child.url)) {
      continue;
    }

    result.push({
      id: child.id,
      parentId: child.parentId,
      title: child.title.trim() || t('common.unnamedBookmark'),
      url: child.url,
      folderPath: path,
      sectionTitle,
    });
  }
}

/**
 * 本地书签搜索。
 *
 * 仅匹配标题、URL、文件夹路径；不请求搜索引擎，不记录关键词。
 * 排序按匹配强度、标题长度和标题排序，最多返回 limit 条。
 */
export function searchBookmarks(
  bookmarks: readonly SearchableBookmark[],
  rawQuery: string,
  limit = 5,
): SearchableBookmark[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) {
    return [];
  }

  return bookmarks
    .map((bookmark) => ({
      bookmark,
      score: scoreBookmark(bookmark, query),
    }))
    .filter((item) => item.score !== null)
    .sort(
      (left, right) =>
        (left.score ?? 0) - (right.score ?? 0) ||
        left.bookmark.title.length - right.bookmark.title.length ||
        left.bookmark.title.localeCompare(right.bookmark.title, 'zh-CN'),
    )
    .slice(0, Math.max(0, limit))
    .map((item) => item.bookmark);
}

function scoreBookmark(bookmark: SearchableBookmark, query: string): number | null {
  const title = bookmark.title.toLocaleLowerCase();
  const url = bookmark.url.toLocaleLowerCase();
  const folder = bookmark.folderPath.toLocaleLowerCase();

  if (title.startsWith(query)) return 0;
  if (title.includes(query)) return 1;
  if (url.includes(query)) return 2;
  if (folder.includes(query)) return 3;
  return null;
}
