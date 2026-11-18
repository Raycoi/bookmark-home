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
      `页面脚本执行失败: ${
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
      }`,
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
function findByTitle(tree, title) {
  return flatten(tree).find((node) => node.title === title);
}
function countByTitle(tree, title) {
  return flatten(tree).filter((node) => node.title === title).length;
}
function childrenOf(tree, id) {
  return flatten(tree).find((node) => node.id === id)?.children ?? [];
}
function assert(checks, name, condition, details) {
  checks[name] = { ok: Boolean(condition), details };
  if (!condition) {
    console.error(`FAIL ${name}`, details);
  }
}

async function installHelpers() {
  await evaluate(`(() => {
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };

    window.__bh = {
      clickButton(text, scope = document) {
        const button = [...scope.querySelectorAll('button')].find(
          (node) => node.textContent?.trim() === text,
        );
        if (!button) return false;
        button.click();
        return true;
      },
      clickSelector(selector) {
        const element = document.querySelector(selector);
        if (!element) return false;
        element.click();
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
      clickFolderMore(title) {
        const group = [...document.querySelectorAll('.bookmark-group')].find(
          (node) =>
            node.querySelector(':scope > .bookmark-group__heading .section-title')?.textContent?.trim() === title,
        );
        const groupButton = group?.querySelector(':scope > .bookmark-group__heading .group-more');
        if (groupButton) {
          groupButton.click();
          return true;
        }
        const heading = [...document.querySelectorAll('.bookmark-folder__heading')].find(
          (node) => node.querySelector('.bookmark-folder__title')?.textContent?.trim() === title,
        );
        const folderButton = heading?.querySelector('.folder-more');
        if (!folderButton) return false;
        folderButton.click();
        return true;
      },
      clickOtherMore() {
        const button = document.querySelector('.other-bookmarks__more');
        if (!button) return false;
        button.click();
        return true;
      },
      clickAdd() {
        const button = document.querySelector('.add-button');
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
      dialogInfo() {
        const panel = document.querySelector('.dialog-panel');
        if (!panel) return null;
        return {
          title: panel.querySelector('.dialog-title')?.textContent?.trim(),
          inputs: [...panel.querySelectorAll('input')].map((node) => node.value),
          selectedLocation:
            panel.querySelector('select option:checked')?.textContent?.trim() ?? null,
          primaryLabel:
            panel.querySelector('.dialog-footer .bh-button--primary, .dialog-footer .bh-button--danger')
              ?.textContent?.trim() ?? null,
          primaryDisabled:
            panel.querySelector('.dialog-footer .bh-button--primary, .dialog-footer .bh-button--danger')
              ?.disabled ?? null,
          error: panel.querySelector('.bh-dialog-error')?.textContent?.trim() ?? null,
          warning: panel.querySelector('.bh-warning')?.textContent?.trim() ?? null,
        };
      },
      fillBookmark(title, url, locationText) {
        const panel = document.querySelector('.dialog-panel');
        const inputs = panel?.querySelectorAll('input');
        if (!inputs || inputs.length < 2) return false;
        setValue(inputs[0], title);
        setValue(inputs[1], url);
        const select = panel.querySelector('select');
        if (select && locationText) {
          const option = [...select.options].find((node) =>
            node.textContent?.trim().endsWith(locationText),
          );
          if (!option) return false;
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      },
      fillFolder(title, locationText) {
        const panel = document.querySelector('.dialog-panel');
        const input = panel?.querySelector('input');
        if (!input) return false;
        setValue(input, title);
        const select = panel.querySelector('select');
        if (select && locationText) {
          const option = [...select.options].find((node) =>
            node.textContent?.trim().endsWith(locationText),
          );
          if (!option) return false;
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      },
      clickDialogButton(text) {
        const button = [...document.querySelectorAll('.dialog-footer button')].find(
          (node) => node.textContent?.trim() === text,
        );
        if (!button) return false;
        button.click();
        return true;
      },
      clickDialogPrimary() {
        const button = document.querySelector(
          '.dialog-footer .bh-button--primary, .dialog-footer .bh-button--danger',
        );
        if (!button) return false;
        button.click();
        return true;
      },
      doubleClickDialogPrimary() {
        const button = document.querySelector('.dialog-footer .bh-button--primary');
        if (!button) return false;
        button.click();
        button.click();
        return true;
      },
      selectMoveFolder(id) {
        const radio = document.querySelector(
          '.folder-picker input[type="radio"][value="' + id + '"]',
        );
        if (!radio) return false;
        radio.click();
        return true;
      },
      radioValues() {
        return [...document.querySelectorAll('.folder-picker input[type="radio"]')].map(
          (node) => node.value,
        );
      },
      folderLabels() {
        return [...document.querySelectorAll('.folder-node__name')].map(
          (node) => node.textContent?.trim(),
        );
      },
      toastText() {
        return document.querySelector('.operation-toast__message')?.textContent?.trim() ?? null;
      },
      domTitles(selector = '.bookmark-name') {
        return [...document.querySelectorAll(selector)].map((node) =>
          node.textContent?.trim(),
        );
      },
      openContextMenu(title, x, y) {
        const entry = [...document.querySelectorAll('.bookmark-entry')].find(
          (node) => node.querySelector('.bookmark-name')?.textContent?.trim() === title,
        );
        if (!entry) return false;
        entry.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
        return true;
      },
      pressEscape() {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      },
      clickOutsideMenu() {
        document.body.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
        );
      },
      dialogVisible() {
        return Boolean(document.querySelector('.dialog-panel'));
      },
    };
  })()`);
}

async function waitDialogClosed() {
  await waitFor(`!document.querySelector('.dialog-panel')`);
  await sleep(400);
}
async function waitForTitle(title) {
  await waitFor(
    `[...document.querySelectorAll('.bookmark-name')].some((node) => node.textContent?.trim() === ${JSON.stringify(title)})`,
  );
}
async function waitForTitleGone(title) {
  await waitFor(
    `![...document.querySelectorAll('.bookmark-name')].some((node) => node.textContent?.trim() === ${JSON.stringify(title)})`,
  );
}
async function openBookmarkMenu(title) {
  const ok = await evaluate(`__bh.clickBookmarkMore(${JSON.stringify(title)})`);
  if (!ok) throw new Error(`找不到书签菜单：${title}`);
  await waitFor(`Boolean(document.querySelector('.context-menu'))`);
}
async function openFolderMenu(title) {
  const ok = await evaluate(`__bh.clickFolderMore(${JSON.stringify(title)})`);
  if (!ok) throw new Error(`找不到文件夹菜单：${title}`);
  await waitFor(`Boolean(document.querySelector('.context-menu'))`);
}
async function openOtherMenu() {
  const ok = await evaluate('__bh.clickOtherMore()');
  if (!ok) throw new Error('找不到其他书签菜单');
  await waitFor(`Boolean(document.querySelector('.context-menu'))`);
}
async function openGlobalAddMenu() {
  const ok = await evaluate('__bh.clickAdd()');
  if (!ok) throw new Error('找不到添加按钮');
  await waitFor(`Boolean(document.querySelector('.context-menu'))`);
}
async function clickMenu(text) {
  const ok = await evaluate(`__bh.menuAction(${JSON.stringify(text)})`);
  if (!ok) throw new Error(`找不到菜单项：${text}`);
  await sleep(120);
}
async function openAddBookmarkDialog() {
  await openGlobalAddMenu();
  await clickMenu('新增书签');
  await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
  await sleep(120);
}
async function openAddFolderDialog() {
  await openGlobalAddMenu();
  await clickMenu('新建文件夹');
  await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
  await sleep(120);
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

  await link('1', 'Alpha', 'https://alpha.example/');
  await link('1', 'Beta', 'https://beta.example/');
  await link('1', 'Gamma', 'https://gamma.example/');

  const work = await folder('1', '工作');
  await link(work.id, 'One', 'https://one.example/');
  await link(work.id, 'Two', 'https://two.example/');
  const child = await folder(work.id, '子项');
  await link(child.id, 'Three', 'https://three.example/');

  const fun = await folder('1', '娱乐');
  await link(fun.id, 'Four', 'https://four.example/');
  await folder('1', '空文件夹');

  const doomed = await folder('1', '待删除');
  await link(doomed.id, 'DeleteMe1', 'https://delete1.example/');
  await link(doomed.id, 'DeleteMe2', 'https://delete2.example/');
  const deep = await folder(doomed.id, '嵌套待删');
  await link(deep.id, 'DeleteMe3', 'https://delete3.example/');

  await link('2', 'Other One', 'https://other.example/');
  const later = await folder('2', '稍后');
  await link(later.id, 'Later', 'https://later.example/');

  return {
    workId: work.id,
    childId: child.id,
    funId: fun.id,
    doomedId: doomed.id,
    deepId: deep.id,
    laterId: later.id,
  };
})()`);

await waitFor(`document.querySelectorAll('.bookmark-item').length >= 12`);
await sleep(500);

const checks = {};
const screenshots = {};

// 右键菜单：位置约束与 Escape 关闭
await evaluate('__bh.openContextMenu("Gamma", window.innerWidth - 5, window.innerHeight - 5)');
await waitFor(`Boolean(document.querySelector('.context-menu'))`);
const menuInfo = await evaluate(`(() => {
  const menu = document.querySelector('.context-menu');
  const rect = menu.getBoundingClientRect();
  return {
    items: [...menu.querySelectorAll('.context-menu__item')].map((node) => node.textContent?.trim()),
    inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
  };
})()`);
screenshots.context = await capture('phase-3-context-menu-final.png');
await evaluate('__bh.pressEscape()');
await sleep(150);
const menuClosedByEscape = await evaluate(`!document.querySelector('.context-menu')`);
assert(checks, 'contextMenuViewportAndActions', menuInfo.inside && menuInfo.items.includes('编辑书签') && menuInfo.items.includes('删除书签'), menuInfo);
assert(checks, 'contextMenuEscape', menuClosedByEscape, menuClosedByEscape);

// 新增书签到书签栏（默认位置）
await openAddBookmarkDialog();
let dialog = await evaluate('__bh.dialogInfo()');
screenshots.addDialog = await capture('phase-3-add-dialog-final.png');
assert(checks, 'addDialogDefaultsToBar', dialog?.title === '新增书签' && dialog?.selectedLocation === '书签栏', dialog);
await evaluate('__bh.fillBookmark("Added Bar", "added.example/path")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
await waitForTitle('Added Bar');
let tree = await getTree();
let addedBar = findByTitle(tree, 'Added Bar');
assert(checks, 'createBookmarkInBar', addedBar?.parentId === '1' && addedBar?.url === 'https://added.example/path', addedBar);

// 在文件夹菜单新增，应默认到该文件夹
await openFolderMenu('工作');
await clickMenu('新增书签');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
dialog = await evaluate('__bh.dialogInfo()');
assert(checks, 'folderMenuAddDefaultsToFolder', dialog?.selectedLocation?.endsWith('工作') ?? false, dialog);
await evaluate('__bh.fillBookmark("Inside Work", "https://inside.example/")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
await waitForTitle('Inside Work');
tree = await getTree();
let insideWork = findByTitle(tree, 'Inside Work');
assert(checks, 'createBookmarkInFolder', insideWork?.parentId === seeded.workId, insideWork);

// 从全局入口新增，并在弹窗中改到娱乐文件夹
await openAddBookmarkDialog();
await evaluate(`__bh.fillBookmark("Picked Place", "https://picked.example/", "娱乐")`);
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
tree = await getTree();
const picked = findByTitle(tree, 'Picked Place');
assert(checks, 'createBookmarkWithChosenParent', picked?.parentId === seeded.funId, picked);

// 其他书签区域新增，默认保存到其他书签
await openOtherMenu();
await clickMenu('新增书签');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
dialog = await evaluate('__bh.dialogInfo()');
assert(checks, 'otherMenuAddDefaultsToOther', dialog?.selectedLocation === '其他书签', dialog);
await evaluate('__bh.fillBookmark("Inside Other", "https://inside-other.example/")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
tree = await getTree();
const insideOther = findByTitle(tree, 'Inside Other');
assert(checks, 'createBookmarkInOther', insideOther?.parentId === '2', insideOther);

// 其他书签区域新建文件夹，默认保存到其他书签
await openOtherMenu();
await clickMenu('新建文件夹');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
dialog = await evaluate('__bh.dialogInfo()');
assert(checks, 'otherMenuFolderDefaultsToOther', dialog?.selectedLocation === '其他书签', dialog);
await evaluate('__bh.fillFolder("Inside Other Folder")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
tree = await getTree();
const otherFolder = findByTitle(tree, 'Inside Other Folder');
assert(checks, 'createFolderInOther', otherFolder?.parentId === '2' && !otherFolder?.url, otherFolder);

// 新建文件夹与子文件夹
await openAddFolderDialog();
await evaluate('__bh.fillFolder("新分类")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
tree = await getTree();
const newFolder = findByTitle(tree, '新分类');
assert(checks, 'createFolderInBar', newFolder?.parentId === '1' && !newFolder?.url, newFolder);

await openFolderMenu('新分类');
await clickMenu('新建子文件夹');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
dialog = await evaluate('__bh.dialogInfo()');
assert(checks, 'subfolderDialogDefaultsToParent', dialog?.selectedLocation?.endsWith('新分类') ?? false, dialog);
await evaluate('__bh.fillFolder("子分类")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
tree = await getTree();
const childFolder = findByTitle(tree, '子分类');
assert(checks, 'createNestedFolder', childFolder?.parentId === newFolder?.id, childFolder);

// 表单验证：空名称、非法 URL、空文件夹名称
await openAddBookmarkDialog();
const beforeValidation = flatten(await getTree()).length;
await evaluate('__bh.fillBookmark("", "https://valid.example/")');
await evaluate('__bh.clickDialogPrimary()');
await sleep(200);
dialog = await evaluate('__bh.dialogInfo()');
const emptyNameError = dialog?.error?.includes('名称不能为空') ?? false;
await evaluate('__bh.fillBookmark("Bad URL", "javascript:alert(1)")');
await evaluate('__bh.clickDialogPrimary()');
await sleep(200);
dialog = await evaluate('__bh.dialogInfo()');
const invalidUrlError = dialog?.error?.includes('只支持') ?? false;
const afterValidation = flatten(await getTree()).length;
await evaluate('__bh.clickDialogButton("取消")');
await waitDialogClosed();
assert(checks, 'validationEmptyNameAndUrl', emptyNameError && invalidUrlError && beforeValidation === afterValidation, {
  emptyNameError,
  invalidUrlError,
  beforeValidation,
  afterValidation,
});

await openAddFolderDialog();
await evaluate('__bh.fillFolder("")');
await evaluate('__bh.clickDialogPrimary()');
await sleep(200);
dialog = await evaluate('__bh.dialogInfo()');
const emptyFolderError = dialog?.error?.includes('不能为空') ?? false;
await evaluate('__bh.clickDialogButton("取消")');
await waitDialogClosed();
assert(checks, 'validationEmptyFolderName', emptyFolderError, dialog);

// 编辑只改名称
await openBookmarkMenu('Alpha');
await clickMenu('编辑书签');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
dialog = await evaluate('__bh.dialogInfo()');
const editPrefill = dialog?.inputs?.[0] === 'Alpha' && dialog?.inputs?.[1] === 'https://alpha.example/';
await evaluate('__bh.fillBookmark("Alpha Renamed", "https://alpha.example/")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
await waitForTitle('Alpha Renamed');
tree = await getTree();
const alphaRenamed = findByTitle(tree, 'Alpha Renamed');
assert(checks, 'editBookmarkNameOnly', editPrefill && alphaRenamed?.url === 'https://alpha.example/', { editPrefill, alphaRenamed });

// 编辑 URL
await openBookmarkMenu('Alpha Renamed');
await clickMenu('编辑书签');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate('__bh.fillBookmark("Alpha Renamed", "alpha.example/new")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
tree = await getTree();
const alphaNewUrl = findByTitle(tree, 'Alpha Renamed');
assert(checks, 'editBookmarkUrl', alphaNewUrl?.url === 'https://alpha.example/new' && alphaNewUrl?.title === 'Alpha Renamed', alphaNewUrl);

// 文件夹重命名
await openFolderMenu('工作');
await clickMenu('重命名文件夹');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate('__bh.fillFolder("工作区")');
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
tree = await getTree();
const workRenamed = findByTitle(tree, '工作区');
assert(checks, 'renameFolderKeepsChildren', workRenamed?.id === seeded.workId && childrenOf(tree, seeded.workId).length === 4, workRenamed);

// 移动弹窗：当前父级不可直接确认，文件夹子树被排除
await openFolderMenu('工作区');
await clickMenu('移动到文件夹…');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
let moveDialog = await evaluate('__bh.dialogInfo()');
const moveLabels = await evaluate('__bh.folderLabels()');
const moveDisabledAtCurrent = moveDialog?.primaryDisabled === true;
await evaluate('__bh.pressEscape()');
await waitDialogClosed();
assert(checks, 'moveFolderPickerExcludesSelfSubtree', !moveLabels.includes('子项') && moveDisabledAtCurrent, {
  moveLabels,
  moveDisabledAtCurrent,
});

// 移动书签：Two -> 娱乐
await openBookmarkMenu('Two');
await clickMenu('移动到文件夹…');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
screenshots.moveDialog = await capture('phase-3-move-dialog.png');
const twoMoveVisible = await evaluate('__bh.dialogInfo()');
await evaluate(`__bh.selectMoveFolder(${JSON.stringify(seeded.funId)})`);
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
await sleep(300);
tree = await getTree();
const twoMoved = findByTitle(tree, 'Two');
assert(checks, 'moveBookmarkViaPicker', twoMoved?.parentId === seeded.funId, { twoMoved, dialog: twoMoveVisible });

// 通过弹窗移动文件夹：子项 -> 娱乐
await openFolderMenu('子项');
await clickMenu('移动到文件夹…');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate(`__bh.selectMoveFolder(${JSON.stringify(seeded.funId)})`);
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
await sleep(300);
tree = await getTree();
const childMoved = findByTitle(tree, '子项');
const threeStillInside = findByTitle(tree, 'Three')?.parentId === seeded.childId;
assert(checks, 'moveFolderViaPickerKeepsDescendants', childMoved?.parentId === seeded.funId && threeStillInside, {
  childMoved,
  threeParent: findByTitle(tree, 'Three')?.parentId,
});

// 删除书签：先取消，再确认
await openBookmarkMenu('Beta');
await clickMenu('删除书签');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
let deleteDialog = await evaluate('__bh.dialogInfo()');
const deleteBookmarkTitle = deleteDialog?.title?.includes('Beta') ?? false;
await evaluate('__bh.clickDialogButton("取消")');
await waitDialogClosed();
const betaStillThere = Boolean(findByTitle(await getTree(), 'Beta'));
await openBookmarkMenu('Beta');
await clickMenu('删除书签');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
await waitForTitleGone('Beta');
const betaGone = !findByTitle(await getTree(), 'Beta');
assert(checks, 'deleteBookmarkCancelThenConfirm', deleteBookmarkTitle && betaStillThere && betaGone, {
  deleteBookmarkTitle,
  betaStillThere,
  betaGone,
});

// 删除非空文件夹：取消、提示、确认
await openFolderMenu('待删除');
await clickMenu('删除文件夹');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
deleteDialog = await evaluate('__bh.dialogInfo()');
screenshots.deleteDialog = await capture('phase-3-delete-folder-confirm.png');
const warningCounts = deleteDialog?.warning?.includes('3 个书签') && deleteDialog?.warning?.includes('1 个子文件夹');
await evaluate('__bh.clickDialogButton("取消")');
await waitDialogClosed();
const doomedStillThere = Boolean(findByTitle(await getTree(), '待删除'));
await openFolderMenu('待删除');
await clickMenu('删除文件夹');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
await sleep(300);
tree = await getTree();
const doomedGone =
  !findByTitle(tree, '待删除') &&
  !findByTitle(tree, 'DeleteMe1') &&
  !findByTitle(tree, 'DeleteMe2') &&
  !findByTitle(tree, 'DeleteMe3');
assert(checks, 'deleteNonEmptyFolderWithWarning', warningCounts && doomedStillThere && doomedGone, {
  warningCounts,
  doomedStillThere,
  doomedGone,
});

// 删除空文件夹
await openFolderMenu('空文件夹');
await clickMenu('删除文件夹');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
deleteDialog = await evaluate('__bh.dialogInfo()');
const emptyWarning = deleteDialog?.warning?.includes('空文件夹') ?? false;
await evaluate('__bh.clickDialogPrimary()');
await waitDialogClosed();
const emptyGone = !findByTitle(await getTree(), '空文件夹');
assert(checks, 'deleteEmptyFolder', emptyWarning && emptyGone, { emptyWarning, emptyGone });

// 防止连续提交重复创建
await openAddBookmarkDialog();
await evaluate('__bh.fillBookmark("Double Add", "https://double.example/")');
await evaluate('__bh.doubleClickDialogPrimary()');
await waitDialogClosed();
await sleep(500);
tree = await getTree();
const doubleCount = countByTitle(tree, 'Double Add');
assert(checks, 'preventDuplicateCreate', doubleCount === 1, { doubleCount });

// 真实 API 失败：编辑期间原生书签被外部删除
const failure = await evaluate(`(async () => {
  const tree = await chrome.bookmarks.getTree();
  const all = [];
  const visit = (node) => {
    all.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree[0]);
  const parent = all.find((node) => node.title === '工作区');
  const created = await chrome.bookmarks.create({
    parentId: parent.id,
    title: 'Failure Test',
    url: 'https://failure.example/',
  });
  return created.id;
})()`);
await waitForTitle('Failure Test');
await openBookmarkMenu('Failure Test');
await clickMenu('编辑书签');
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate(`chrome.bookmarks.remove(${JSON.stringify(failure)})`);
await evaluate('__bh.fillBookmark("Failure Test Renamed", "https://failure.example/")');
await evaluate('__bh.clickDialogPrimary()');
await sleep(600);
const failureDialog = await evaluate('__bh.dialogInfo()');
const failureError = failureDialog?.error?.includes('修改书签失败') ?? false;
await evaluate('__bh.clickDialogButton("取消")');
await waitDialogClosed();
assert(checks, 'apiFailureShowsError', failureError, failureDialog);

// 页面重载后保持原生顺序与结构
await send('Page.reload', { ignoreCache: false });
await waitFor(`Boolean(document.querySelector('.home'))`);
await waitFor(`document.querySelectorAll('.bookmark-item').length >= 8`);
await installHelpers();
await sleep(400);
const afterReload = await evaluate(`({
  quickLinks: __bh.domTitles('.quick-links .bookmark-name'),
  groups: [...document.querySelectorAll('.bookmark-group .section-title')].map((node) => node.textContent?.trim()),
  hasOther: Boolean(document.querySelector('.other-bookmarks')),
})`);
tree = await getTree();
const finalTreeTitles = flatten(tree).map((node) => node.title);
assert(
  checks,
  'reloadKeepsOrderAndStructure',
  afterReload.quickLinks.includes('Alpha Renamed') &&
    afterReload.quickLinks.includes('Gamma') &&
    afterReload.groups.includes('工作区') &&
    afterReload.groups.includes('娱乐') &&
    finalTreeTitles.includes('子项') &&
    finalTreeTitles.includes('Double Add'),
  afterReload,
);

screenshots.final = await capture('phase-3-home-final.png');

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
      failed: Object.entries(checks).filter(([, value]) => !value.ok).map(([key]) => key),
    },
    null,
    2,
  ),
);

socket.close();
if (Object.values(checks).some((entry) => !entry.ok)) {
  process.exitCode = 1;
}
