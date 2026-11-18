import type { NativeBookmarkNode } from '../../src/types/bookmark';

export function nativeBookmark(
  id: string,
  parentId: string,
  index: number,
  title: string,
  url: string,
): NativeBookmarkNode {
  return { id, parentId, index, title, url };
}

export function nativeFolder(
  id: string,
  parentId: string,
  index: number,
  title: string,
  children: NativeBookmarkNode[] = [],
): NativeBookmarkNode {
  return { id, parentId, index, title, children };
}

function permanentFolder(
  id: string,
  index: number,
  title: string,
  children: NativeBookmarkNode[],
): NativeBookmarkNode {
  return { id, parentId: '0', index, title, children };
}

export function makeTree(
  barChildren: NativeBookmarkNode[],
  otherChildren: NativeBookmarkNode[] = [],
  mobileChildren?: NativeBookmarkNode[],
): NativeBookmarkNode[] {
  const children: NativeBookmarkNode[] = [
    permanentFolder('1', 0, '书签栏', barChildren),
    permanentFolder('2', 1, '其他书签', otherChildren),
  ];

  if (mobileChildren !== undefined) {
    children.push(permanentFolder('3', 2, '移动设备书签', mobileChildren));
  }

  return [{ id: '0', title: '', children }];
}

/** 与需求文档中的示例结构一致，并包含其他书签和移动设备书签。 */
export function makeStandardTree(): NativeBookmarkNode[] {
  const aiTools = nativeFolder('folder-ai', '1', 3, 'AI 工具', [
    nativeBookmark('bm-chatgpt', 'folder-ai', 0, 'ChatGPT', 'https://chatgpt.com/'),
    nativeBookmark('bm-deepseek', 'folder-ai', 1, 'DeepSeek', 'https://chat.deepseek.com/'),
    nativeBookmark('bm-claude', 'folder-ai', 2, 'Claude', 'https://claude.ai/'),
  ]);

  const devTools = nativeFolder('folder-dev', '1', 4, '开发工具', [
    nativeBookmark('bm-github-dev', 'folder-dev', 0, 'GitHub', 'https://github.com/'),
    nativeBookmark(
      'bm-stackoverflow',
      'folder-dev',
      1,
      'Stack Overflow',
      'https://stackoverflow.com/',
    ),
  ]);

  const entertainment = nativeFolder('folder-fun', '1', 5, '娱乐', [
    nativeBookmark('bm-bilibili', 'folder-fun', 0, 'Bilibili', 'https://www.bilibili.com/'),
    nativeBookmark('bm-steam', 'folder-fun', 1, 'Steam', 'https://store.steampowered.com/'),
  ]);

  const bar = [
    nativeBookmark('bm-google', '1', 0, 'Google', 'https://www.google.com/'),
    nativeBookmark('bm-youtube', '1', 1, 'YouTube', 'https://www.youtube.com/'),
    nativeBookmark('bm-github', '1', 2, 'GitHub', 'https://github.com/'),
    aiTools,
    devTools,
    entertainment,
  ];

  const reading = nativeFolder('folder-reading', '2', 1, '待读', [
    nativeBookmark('bm-article', 'folder-reading', 0, '文章', 'https://example.com/article'),
  ]);

  const other = [
    nativeBookmark('bm-docs', '2', 0, 'Docs', 'https://developer.chrome.com/docs/'),
    reading,
  ];

  return makeTree(bar, other, [
    nativeBookmark('bm-mobile', '3', 0, '移动端书签', 'https://example.org/mobile'),
  ]);
}
