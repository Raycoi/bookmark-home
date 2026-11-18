import { defineConfig } from 'wxt';

/**
 * WXT 配置。
 *
 * 新标签页通过 entrypoints/newtab 目录约定声明，WXT 会自动生成
 * chrome_url_overrides.newtab，不需要在 manifest 中重复配置。
 */
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Bookmark Home',
    description: '把 Chrome 原生书签展示为新标签页，并保持双向同步。',
    permissions: ['bookmarks', 'storage', 'favicon', 'alarms'],
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
  },
});
