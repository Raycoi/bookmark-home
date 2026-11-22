import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  DEFAULT_SEARCH_ENGINE_ID,
  SEARCH_ENGINES,
  buildSearchUrl,
  findSearchEngine,
  isSearchEngineId,
  type SearchEngine,
  type SearchEngineId,
} from '../config/searchEngines';
import {
  readSearchEnginePreference,
  saveSearchEnginePreference,
  SEARCH_ENGINE_STORAGE_KEY,
} from '../services/settingsService';

/**
 * 搜索状态与偏好接口。
 *
 * 当前只有一个偏好字段；搜索引擎配置和 settingsService 都保持独立，
 * 不在组件里重复读取或校验。
 */
export function useSearch() {
  const selectedEngineId = ref<SearchEngineId>(DEFAULT_SEARCH_ENGINE_ID);
  let userChangedEngine = false;

  const currentEngine = computed<SearchEngine>(() => {
    return findSearchEngine(selectedEngineId.value) ?? SEARCH_ENGINES[0];
  });

  function setSearchEngine(id: string): void {
    if (!isSearchEngineId(id) || id === selectedEngineId.value) {
      return;
    }

    userChangedEngine = true;
    selectedEngineId.value = id;
    void saveSearchEnginePreference(id);
  }

  function submitSearch(query: string): boolean {
    const url = buildSearchUrl(currentEngine.value, query);
    if (!url) {
      return false;
    }

    window.location.assign(url);
    return true;
  }

  onMounted(() => {
    void (async () => {
      const storedId = await readSearchEnginePreference();
      // 用户若在异步读取完成前已经切换，不能被旧偏好覆盖。
      if (!userChangedEngine) {
        selectedEngineId.value = storedId;
      }
    })();

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChanged);
    }
  });

  onUnmounted(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    }
  });

  function onStorageChanged(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void {
    if (areaName !== 'sync' || !(SEARCH_ENGINE_STORAGE_KEY in changes)) {
      return;
    }
    const value = changes[SEARCH_ENGINE_STORAGE_KEY]?.newValue;
    if (typeof value === 'string' && isSearchEngineId(value)) {
      selectedEngineId.value = value;
      userChangedEngine = true;
    }
  }

  return {
    engines: SEARCH_ENGINES,
    selectedEngineId,
    currentEngine,
    setSearchEngine,
    submitSearch,
  };
}
