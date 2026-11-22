import type {
  HomepageData,
  HomepageFolder,
  HomepageSection,
} from '../types/bookmark';
import { normalizeHealthUrl } from './healthUrl';
import { t } from '../i18n';

/** 健康检查面板中的一个完整 URL 条目；相同 URL 的多个书签合并计数。 */
export interface HealthBookmarkEntry {
  key: string;
  rawUrl: string;
  normalizedUrl: string | null;
  title: string;
  folderPath: string;
  bookmarkId: string;
  parentId: string;
  bookmarkCount: number;
  sectionTitle: string;
  /** 是否会在主页书签栏/其他书签中展示。 */
  isHomepageVisible: boolean;
}

interface SectionMeta {
  sectionTitle: string;
  isHomepageVisible: boolean;
}

/**
 * 展开完整主页数据（含移动设备/额外区域），按规范化完整 URL 去重。
 *
 * 非 HTTP(S) 地址保留为 normalizedUrl=null，由 UI 展示“无法检测”，
 * 不进入后台检测队列；内网/本机地址由 UI 展示“内网地址”。
 */
export function collectHomepageHealthEntries(
  data: HomepageData | null,
): HealthBookmarkEntry[] {
  if (!data) {
    return [];
  }

  const entries = new Map<string, HealthBookmarkEntry>();
  const sections: HomepageSection[] = [
    data.bookmarksBar,
    data.otherBookmarks,
    ...(data.mobileBookmarks ? [data.mobileBookmarks] : []),
    ...data.extraSections,
  ];

  for (const section of sections) {
    const sectionTitle = section.title.trim() || t('common.unnamedSection');
    visitFolder(
      section,
      sectionTitle,
      entries,
      {
        sectionTitle,
        isHomepageVisible:
          section.role === 'bookmarks-bar' || section.role === 'other-bookmarks',
      },
    );
  }

  return [...entries.values()];
}

function visitFolder(
  folder: HomepageFolder,
  path: string,
  entries: Map<string, HealthBookmarkEntry>,
  section: SectionMeta,
): void {
  for (const child of folder.children) {
    if (child.type === 'folder') {
      const title = child.title.trim() || t('common.unnamedFolder');
      visitFolder(child, `${path} / ${title}`, entries, section);
      continue;
    }

    const rawUrl = child.url;
    const normalizedUrl = normalizeHealthUrl(rawUrl);
    const key = normalizedUrl ?? `unsupported:${rawUrl.trim()}`;
    const existing = entries.get(key);

    if (existing) {
      existing.bookmarkCount += 1;
      existing.isHomepageVisible ||= section.isHomepageVisible;
      continue;
    }

    entries.set(key, {
      key,
      rawUrl,
      normalizedUrl,
      title: child.title.trim() || t('common.unnamedBookmark'),
      folderPath: path,
      bookmarkId: child.id,
      parentId: child.parentId,
      bookmarkCount: 1,
      sectionTitle: section.sectionTitle,
      isHomepageVisible: section.isHomepageVisible,
    });
  }
}
