import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_ENGINE_ID,
  SEARCH_ENGINES,
  buildSearchUrl,
  findSearchEngine,
  isSearchEngineId,
} from '../src/config/searchEngines';

describe('搜索配置', () => {
  it('默认搜索引擎存在且配置了 https 搜索地址', () => {
    const engine = findSearchEngine(DEFAULT_SEARCH_ENGINE_ID);
    expect(engine).toBeDefined();
    expect(engine?.searchUrl.startsWith('https://')).toBe(true);
  });

  it('识别合法的搜索引擎 ID', () => {
    expect(isSearchEngineId('google')).toBe(true);
    expect(isSearchEngineId('baidu')).toBe(true);
    expect(isSearchEngineId('unknown-engine')).toBe(false);
    expect(findSearchEngine('unknown-engine')).toBeUndefined();
  });

  it('生成经过编码的搜索地址并去除首尾空白', () => {
    const engine = findSearchEngine('google');
    expect(engine).toBeDefined();
    if (!engine) {
      throw new Error('Google 搜索引擎应存在');
    }

    expect(buildSearchUrl(engine, '  hello 世界  ')).toBe(
      'https://www.google.com/search?q=hello%20%E4%B8%96%E7%95%8C',
    );
  });

  it('不同引擎使用各自的查询参数', () => {
    const baidu = findSearchEngine('baidu');
    const bing = findSearchEngine('bing');
    expect(baidu && buildSearchUrl(baidu, '书签')).toContain('baidu.com/s?wd=');
    expect(bing && buildSearchUrl(bing, '书签')).toContain('bing.com/search?q=');
  });

  it('空关键词不生成导航地址', () => {
    const engine = SEARCH_ENGINES[0];
    expect(buildSearchUrl(engine, '   ')).toBeNull();
    expect(buildSearchUrl(engine, '')).toBeNull();
  });
});
