import { writeFile } from 'node:fs/promises';
import { SHOT_DIR, getExtensionUrl } from './lib/config.mjs';

const PORT = 9344;
const EXTENSION_URL = await getExtensionUrl();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pageTarget = targets.find((target) => target.type === 'page');
const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let nextId = 1;

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method) events.push(message);
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error
    ? waiter.reject(new Error(JSON.stringify(message.error)))
    : waiter.resolve(message.result);
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
    );
  }
  return response.result.value;
}
async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch { /* 继续等待 */ }
    await sleep(100);
  }
  throw new Error(`等待条件超时: ${expression}`);
}
async function capture(name) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const path = `${SHOT_DIR}\\${name}`;
  await writeFile(path, Buffer.from(screenshot.data, 'base64'));
  return path;
}
async function getTree() {
  const trees = await evaluate('chrome.bookmarks.getTree()');
  return trees[0];
}
function flatten(node) {
  const result = [];
  const visit = (current) => {
    result.push(current);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return result;
}
function childrenTitles(tree, id) {
  const node = flatten(tree).find((current) => current.id === id);
  return (node?.children ?? []).map((child) => child.title);
}
function assert(checks, name, condition, details) {
  checks[name] = { ok: Boolean(condition), details };
  if (!condition) console.error(`FAIL ${name}`, details);
}

async function installHelpers() {
  await evaluate(`(() => {
    window.__bh = {
      clickButton(text) {
        const button = [...document.querySelectorAll('button')].find(
          (node) => node.textContent?.trim() === text,
        );
        if (!button) return false;
        button.click();
        return true;
      },
      clickBookmarkMore(title) {
        const entry = [...document.querySelectorAll('.bookmark-entry')].find(
          (node) => node.querySelector('.bookmark-name')?.textContent?.trim() === title,
        );
        const button = entry?.querySelector('.bookmark-more');
        if (!button) return false;
        button.click();
        return true;
      },
      menuAction(text) {
        const item = [...document.querySelectorAll('.context-menu__item')].find(
          (node) => node.textContent?.trim() === text,
        );
        if (!item) return false;
        item.click();
        return true;
      },
      clickOutsideMenu() {
        document.body.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
        );
      },
      bookmarkSelector(title) {
        const entry = [...document.querySelectorAll('.bookmark-entry')].find(
          (node) => node.querySelector('.bookmark-name')?.textContent?.trim() === title,
        );
        if (!entry) return null;
        return '[data-bookmark-id="' + entry.dataset.bookmarkId + '"]';
      },
      folderHeadingSelector(id) {
        const group = document.querySelector(
          '.bookmark-group[data-folder-id="' + id + '"] > .bookmark-group__heading',
        );
        if (group) return '.bookmark-group[data-folder-id="' + id + '"] > .bookmark-group__heading';
        const nested = document.querySelector(
          '.bookmark-folder[data-folder-id="' + id + '"] > .bookmark-folder__heading',
        );
        if (nested) return '.bookmark-folder[data-folder-id="' + id + '"] > .bookmark-folder__heading';
        return null;
      },
      startDrag(selector) {
        const source = document.querySelector(selector);
        if (!source) return { ok: false, reason: 'source missing' };
        const dt = new DataTransfer();
        window.__bhDragData = {
          source,
          dt,
        };
        source.dispatchEvent(
          new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
          }),
        );
        return { ok: true };
      },
      dragOver(selector, fraction) {
        const target = document.querySelector(selector);
        const state = window.__bhDragData;
        if (!target || !state) return { ok: false, reason: 'target or drag missing' };
        const rect = target.getBoundingClientRect();
        const clientX = rect.left + rect.width * fraction;
        const clientY = rect.top + rect.height / 2;
        target.dispatchEvent(
          new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.dt,
            clientX,
            clientY,
          }),
        );
        target.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.dt,
            clientX,
            clientY,
          }),
        );
        return {
          ok: true,
          dropBefore: document.querySelectorAll('.bookmark-entry.is-drop-before').length,
          dropAfter: document.querySelectorAll('.bookmark-entry.is-drop-after').length,
          folderTarget: document.querySelectorAll('.is-drop-target').length,
          dragging: document.querySelectorAll('.bookmark-entry.is-dragging, .bookmark-folder.is-dragging, .bookmark-group.is-dragging').length,
        };
      },
      drop(selector, fraction) {
        const target = document.querySelector(selector);
        const state = window.__bhDragData;
        if (!target || !state) return false;
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.dt,
            clientX: rect.left + rect.width * fraction,
            clientY: rect.top + rect.height / 2,
          }),
        );
        return true;
      },
      endDrag() {
        const state = window.__bhDragData;
        if (!state) return false;
        state.source.dispatchEvent(
          new DragEvent('dragend', {
            bubbles: true,
            cancelable: true,
            dataTransfer: state.dt,
          }),
        );
        window.__bhDragData = null;
        return true;
      },
      moveToggle() {
        const toggle = document.querySelector('.folder-picker .folder-node__toggle');
        if (!toggle) return null;
        const before = toggle.getAttribute('aria-expanded');
        toggle.click();
        return { before, after: toggle.getAttribute('aria-expanded') };
      },
      moveLabels() {
        return [...document.querySelectorAll('.folder-node__name')].map(
          (node) => node.textContent?.trim(),
        );
      },
      clickCancel() {
        const button = [...document.querySelectorAll('.dialog-footer button')].find(
          (node) => node.textContent?.trim() === '取消',
        );
        if (!button) return false;
        button.click();
        return true;
      },
      elementCenter(selector) {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      },
      hoverMoreOpacity(selector) {
        const entry = document.querySelector(selector);
        const button = entry?.querySelector('.bookmark-more');
        if (!button) return null;
        return {
          opacity: Number.parseFloat(getComputedStyle(button).opacity),
          pointerEvents: getComputedStyle(button).pointerEvents,
        };
      },
      titles(selector) {
        return [...document.querySelectorAll(selector)].map((node) =>
          node.textContent?.trim(),
        );
      },
      dialogVisible() {
        return Boolean(document.querySelector('.dialog-panel'));
      },
    };
  })()`);
}

async function openBookmarkMenu(title) {
  const ok = await evaluate(`__bh.clickBookmarkMore(${JSON.stringify(title)})`);
  if (!ok) throw new Error(`菜单打开失败：${title}`);
  await waitFor(`Boolean(document.querySelector('.context-menu'))`);
  await sleep(80);
}
async function dragStart(selector) {
  const result = await evaluate(`__bh.startDrag(${JSON.stringify(selector)})`);
  if (!result.ok) throw new Error(`拖动开始失败：${JSON.stringify(result)}`);
  await sleep(80);
}
async function dragOver(selector, fraction) {
  const result = await evaluate(
    `__bh.dragOver(${JSON.stringify(selector)}, ${fraction})`,
  );
  if (!result.ok) throw new Error(`dragover 失败：${JSON.stringify(result)}`);
  await sleep(160);
  return evaluate(`({
    dropBefore: document.querySelectorAll('.bookmark-entry.is-drop-before').length,
    dropAfter: document.querySelectorAll('.bookmark-entry.is-drop-after').length,
    folderTarget: document.querySelectorAll('.is-drop-target').length,
    dragging: document.querySelectorAll('.bookmark-entry.is-dragging, .bookmark-folder.is-dragging, .bookmark-group.is-dragging').length,
  })`);
}
async function dragDrop(selector, fraction) {
  const result = await evaluate(
    `__bh.drop(${JSON.stringify(selector)}, ${fraction})`,
  );
  if (!result) throw new Error('drop 失败');
  await evaluate('__bh.endDrag()');
  await sleep(900);
}
async function dragCancel() {
  await evaluate('__bh.endDrag()');
  await sleep(100);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: EXTENSION_URL });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await waitFor(`Boolean(document.querySelector('.home'))`);
await evaluate(`chrome.storage.local.remove('bookmarkHome.health.state')`);
await installHelpers();

const seeded = await evaluate(`(async () => {
  async function clearSection(id) {
    const tree = await chrome.bookmarks.getSubTree(id);
    for (const child of tree[0]?.children ?? []) {
      if (child.url) await chrome.bookmarks.remove(child.id);
      else await chrome.bookmarks.removeTree(child.id);
    }
  }
  async function folder(parentId, title) {
    return chrome.bookmarks.create({ parentId, title });
  }
  async function link(parentId, title, url) {
    return chrome.bookmarks.create({ parentId, title, url });
  }

  await clearSection('1');
  await clearSection('2');

  const a = await link('1', 'A', 'https://a.example/');
  const b = await link('1', 'B', 'https://b.example/');
  const c = await link('1', 'C', 'https://c.example/');

  const folderA = await folder('1', 'Folder A');
  const a1 = await link(folderA.id, 'A1', 'https://a1.example/');
  const a2 = await link(folderA.id, 'A2', 'https://a2.example/');
  const subA = await folder(folderA.id, 'Sub A');
  const a3 = await link(subA.id, 'A3', 'https://a3.example/');

  const folderB = await folder('1', 'Folder B');
  const b1 = await link(folderB.id, 'B1', 'https://b1.example/');
  const subB = await folder(folderB.id, 'Sub B');
  const b2 = await link(subB.id, 'B2', 'https://b2.example/');

  const empty = await folder('1', 'Empty Folder');

  const o1 = await link('2', 'O1', 'https://o1.example/');
  const folderC = await folder('2', 'Folder C');
  const c1 = await link(folderC.id, 'C1', 'https://c1.example/');

  return {
    a: a.id,
    b: b.id,
    c: c.id,
    folderA: folderA.id,
    a1: a1.id,
    a2: a2.id,
    subA: subA.id,
    a3: a3.id,
    folderB: folderB.id,
    b1: b1.id,
    subB: subB.id,
    b2: b2.id,
    empty: empty.id,
    o1: o1.id,
    folderC: folderC.id,
    c1: c1.id,
  };
})()`);

await waitFor(`document.querySelectorAll('.bookmark-item').length >= 10`);
await sleep(500);

const checks = {};
const screenshots = {};

// 真实鼠标 hover，操作按钮显现
const selectorA = await evaluate(`__bh.bookmarkSelector("A")`);
const centerA = await evaluate(`__bh.elementCenter(${JSON.stringify(selectorA)})`);
await send('Input.dispatchMouseEvent', {
  type: 'mouseMoved',
  x: centerA.x,
  y: centerA.y,
  button: 'none',
});
await sleep(350);
const hoverState = await evaluate(
  `__bh.hoverMoreOpacity(${JSON.stringify(selectorA)})`,
);
screenshots.hover = await capture('phase-3-hover-actions.png');
assert(
  checks,
  'hoverActionVisible',
  (hoverState?.opacity ?? 0) > 0.5 && hoverState?.pointerEvents === 'auto',
  hoverState,
);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
await sleep(150);

// 拖动后立即点击不得误打开网站
await dragStart(selectorA);
const clickPreventedAfterDrag = await evaluate(`(() => {
  const anchor = document.querySelector(${JSON.stringify(`${selectorA} .bookmark-item`)});
  if (!anchor) return null;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  return event.defaultPrevented;
})()`);
await dragCancel();
assert(
  checks,
  'dragSuppressesAccidentalClick',
  clickPreventedAfterDrag === true,
  clickPreventedAfterDrag,
);

// 同级拖拽：C 拖到 A 之前
const selectorC = await evaluate(`__bh.bookmarkSelector("C")`);
let over = await dragOver((await dragStart(selectorC), selectorA), 0.2);
screenshots.dropIndicator = await capture('phase-3-drag-indicator.png');
assert(checks, 'dragIndicatorVisible', over.dropBefore >= 1 && over.dragging >= 1, over);
await dragDrop(selectorA, 0.2);
let tree = await getTree();
let barTitles = childrenTitles(tree, '1');
assert(checks, 'dragReorderInBar', barTitles.join('|') === 'C|A|B|Folder A|Folder B|Empty Folder', barTitles);

// 同级拖拽：A2 拖到 A1 之前
const selectorA2 = await evaluate(`__bh.bookmarkSelector("A2")`);
const selectorA1 = await evaluate(`__bh.bookmarkSelector("A1")`);
over = await dragOver((await dragStart(selectorA2), selectorA1), 0.2);
assert(checks, 'dragIndicatorInFolder', over.dropBefore >= 1, over);
await dragDrop(selectorA1, 0.2);
tree = await getTree();
const folderATitles = childrenTitles(tree, seeded.folderA);
assert(checks, 'dragReorderInFolder', folderATitles.join('|') === 'A2|A1|Sub A', folderATitles);

// 拖拽书签到另一文件夹：A1 -> Folder B
const folderBHeading = await evaluate(
  `__bh.folderHeadingSelector(${JSON.stringify(seeded.folderB)})`,
);
over = await dragOver((await dragStart(selectorA1), folderBHeading), 0.5);
assert(checks, 'dragFolderTargetHighlight', over.folderTarget >= 1, over);
screenshots.folderTarget = await capture('phase-3-folder-drop-target.png');
await dragDrop(folderBHeading, 0.5);
tree = await getTree();
const a1Node = flatten(tree).find((node) => node.id === seeded.a1);
const folderBTitles = childrenTitles(tree, seeded.folderB);
assert(
  checks,
  'dragBookmarkAcrossFolders',
  a1Node?.parentId === seeded.folderB && folderBTitles.join('|') === 'B1|Sub B|A1',
  { a1Parent: a1Node?.parentId, folderBTitles },
);

// 循环保护：Folder A 拖到自己的子文件夹 Sub A，不应允许放置
const folderAHeading = await evaluate(
  `__bh.folderHeadingSelector(${JSON.stringify(seeded.folderA)})`,
);
const subAHeading = await evaluate(
  `__bh.folderHeadingSelector(${JSON.stringify(seeded.subA)})`,
);
over = await dragOver((await dragStart(folderAHeading), subAHeading), 0.5);
assert(checks, 'dragCycleBlockedUI', over.folderTarget === 0 && over.dropBefore === 0 && over.dropAfter === 0, over);
await dragDrop(subAHeading, 0.5);
await dragCancel();
tree = await getTree();
const folderANode = flatten(tree).find((node) => node.id === seeded.folderA);
const subANode = flatten(tree).find((node) => node.id === seeded.subA);
assert(
  checks,
  'dragCycleKeepsStructure',
  folderANode?.parentId === '1' && subANode?.parentId === seeded.folderA,
  { folderAParent: folderANode?.parentId, subAParent: subANode?.parentId },
);

// 文件夹拖入另一文件夹：Sub A -> Empty Folder
const emptyHeading = await evaluate(
  `__bh.folderHeadingSelector(${JSON.stringify(seeded.empty)})`,
);
over = await dragOver((await dragStart(subAHeading), emptyHeading), 0.5);
assert(checks, 'dragFolderHighlight', over.folderTarget >= 1, over);
await dragDrop(emptyHeading, 0.5);
tree = await getTree();
const movedSubA = flatten(tree).find((node) => node.id === seeded.subA);
const movedA3 = flatten(tree).find((node) => node.id === seeded.a3);
assert(
  checks,
  'dragFolderAcrossFolders',
  movedSubA?.parentId === seeded.empty && movedA3?.parentId === seeded.subA,
  { subAParent: movedSubA?.parentId, a3Parent: movedA3?.parentId },
);

// 书签拖到“其他书签”根：B1 -> 其他书签
const selectorB1 = await evaluate(`__bh.bookmarkSelector("B1")`);
over = await dragOver((await dragStart(selectorB1), '.other-bookmarks__summary'), 0.5);
assert(checks, 'dragToOtherRootHighlight', over.folderTarget >= 1, over);
await dragDrop('.other-bookmarks__summary', 0.5);
tree = await getTree();
const b1Node = flatten(tree).find((node) => node.id === seeded.b1);
const otherTitles = childrenTitles(tree, '2');
assert(
  checks,
  'dragBookmarkToOtherRoot',
  b1Node?.parentId === '2' && otherTitles.includes('B1'),
  { b1Parent: b1Node?.parentId, otherTitles },
);

// 右键菜单外部点击关闭
await openBookmarkMenu('A');
const menuBeforeOutside = await evaluate(`Boolean(document.querySelector('.context-menu'))`);
await evaluate('__bh.clickOutsideMenu()');
await sleep(150);
const menuAfterOutside = await evaluate(`Boolean(document.querySelector('.context-menu'))`);
assert(checks, 'contextMenuOutsideClick', menuBeforeOutside && !menuAfterOutside, {
  menuBeforeOutside,
  menuAfterOutside,
});

// 文件夹选择器展开/收起
await openBookmarkMenu('A');
await evaluate(`__bh.menuAction("移动到文件夹…")`);
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
const moveLabels = await evaluate('__bh.moveLabels()');
const toggleBefore = await evaluate(
  `document.querySelector('.folder-picker .folder-node__toggle')?.getAttribute('aria-expanded')`,
);
await evaluate('__bh.moveToggle()');
await sleep(150);
const collapsedChildren = await evaluate(
  `document.querySelectorAll('.folder-picker .folder-node__children').length`,
);
await evaluate('__bh.moveToggle()');
await sleep(150);
const expandedChildren = await evaluate(
  `document.querySelectorAll('.folder-picker .folder-node__children').length`,
);
await evaluate('__bh.clickCancel()');
await waitFor(`!document.querySelector('.dialog-panel')`);
await sleep(200);
assert(
  checks,
  'folderPickerExpandCollapse',
  moveLabels.includes('Folder A') &&
    moveLabels.includes('Empty Folder') &&
    toggleBefore === 'true' &&
    collapsedChildren === 1 &&
    expandedChildren > 1,
  { moveLabels, toggleBefore, collapsedChildren, expandedChildren },
);

// 重载后保留拖拽结果
await send('Page.reload', { ignoreCache: false });
await waitFor(`Boolean(document.querySelector('.home'))`);
await installHelpers();
await waitFor(`document.querySelectorAll('.bookmark-item').length >= 4`);
await sleep(400);
const quickTitles = await evaluate(`__bh.titles('.quick-links .bookmark-name')`);
tree = await getTree();
const finalFolderB = childrenTitles(tree, seeded.folderB);
const finalEmpty = childrenTitles(tree, seeded.empty);
const finalOther = childrenTitles(tree, '2');
assert(
  checks,
  'dragResultsPersistAfterReload',
  quickTitles.join('|') === 'C|A|B' &&
    finalFolderB.includes('Sub B') &&
    finalFolderB.includes('A1') &&
    finalEmpty.includes('Sub A') &&
    finalOther.includes('B1'),
  { quickTitles, finalFolderB, finalEmpty, finalOther },
);
screenshots.final = await capture('phase-3-drag-final.png');

const runtimeErrors = events
  .filter(
    (event) =>
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'),
  )
  .map((event) => ({
    method: event.method,
    text:
      event.params?.exceptionDetails?.exception?.description ??
      event.params?.exceptionDetails?.text ??
      event.params?.entry?.text ??
      'unknown',
  }));
assert(checks, 'noRuntimeErrors', runtimeErrors.length === 0, runtimeErrors);

console.log(
  JSON.stringify(
    {
      checks,
      seeded,
      screenshots,
      runtimeErrors,
      failed: Object.entries(checks)
        .filter(([, value]) => !value.ok)
        .map(([key]) => key),
    },
    null,
    2,
  ),
);

socket.close();
if (Object.values(checks).some((entry) => !entry.ok)) process.exitCode = 1;
