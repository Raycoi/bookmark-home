export interface SearchEngine {
  readonly id: string;
  readonly name: string;
  readonly searchUrl: string;
}

/**
 * 内置搜索引擎。
 *
 * 这里只定义跳转模板，不发起任何请求，也不依赖第三方搜索服务 SDK。
 */
export const SEARCH_ENGINES = [
  {
    id: 'google',
    name: 'Google',
    searchUrl: 'https://www.google.com/search?q=',
  },
  {
    id: 'bing',
    name: 'Bing',
    searchUrl: 'https://www.bing.com/search?q=',
  },
  {
    id: 'baidu',
    name: '百度',
    searchUrl: 'https://www.baidu.com/s?wd=',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    searchUrl: 'https://duckduckgo.com/?q=',
  },
] as const satisfies readonly SearchEngine[];

export type SearchEngineId = (typeof SEARCH_ENGINES)[number]['id'];

export const DEFAULT_SEARCH_ENGINE_ID: SearchEngineId = 'google';

export function isSearchEngineId(value: string): value is SearchEngineId {
  return SEARCH_ENGINES.some((engine) => engine.id === value);
}

export function findSearchEngine(id: string): SearchEngine | undefined {
  return SEARCH_ENGINES.find((engine) => engine.id === id);
}

/** 生成搜索跳转地址；空关键词返回 null，不进行无意义导航。 */
export function buildSearchUrl(engine: SearchEngine, query: string): string | null {
  const keyword = query.trim();
  if (!keyword) {
    return null;
  }
  return `${engine.searchUrl}${encodeURIComponent(keyword)}`;
}
