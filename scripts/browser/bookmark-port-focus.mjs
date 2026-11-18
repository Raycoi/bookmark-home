import { getExtensionUrl } from './lib/config.mjs';

const PORT = 9344;
const EXTENSION_URL = await getExtensionUrl();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((target) => target.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
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
async function waitFor(expression, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch { /* 继续等待 */ }
    await sleep(100);
  }
  throw new Error(`等待条件超时: ${expression}`);
}

await send('Page.enable');
await send('Runtime.enable');
await evaluate(`(async () => {
  async function clearSection(id) {
    const tree = await chrome.bookmarks.getSubTree(id);
    for (const child of tree[0]?.children ?? []) {
      if (child.url) await chrome.bookmarks.remove(child.id);
      else await chrome.bookmarks.removeTree(child.id);
    }
  }
  await clearSection('1');
  await clearSection('2');
})()`);
await send('Page.navigate', { url: EXTENSION_URL });
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await waitFor(`Boolean(document.querySelector('.add-button'))`);
await sleep(500);

await evaluate(`(() => {
  const button = document.querySelector('.add-button');
  button?.focus();
  button?.click();
})()`);
await waitFor(`Boolean(document.querySelector('.context-menu'))`);
await evaluate(`(() => {
  const item = [...document.querySelectorAll('.context-menu__item')].find((node) => node.textContent?.trim() === '新增书签');
  item?.click();
})()`);
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await sleep(150);
const focusedInitially = await evaluate(`({
  title: document.querySelector('.dialog-title')?.textContent?.trim(),
  active: document.activeElement?.className ?? null,
})`);

await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await waitFor(`!document.querySelector('.dialog-panel')`);
await sleep(100);
const focusAfterClose = await evaluate(`document.activeElement?.className ?? null`);

await evaluate(`(() => {
  const button = document.querySelector('.add-button');
  button?.focus();
  button?.click();
})()`);
await waitFor(`Boolean(document.querySelector('.context-menu'))`);
await evaluate(`(() => {
  const item = [...document.querySelectorAll('.context-menu__item')].find((node) => node.textContent?.trim() === '新增书签');
  item?.click();
})()`);
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate(`(() => {
  const panel = document.querySelector('.dialog-panel');
  const inputs = panel?.querySelectorAll('input');
  if (!inputs || inputs.length < 2) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(inputs[0], 'Port Site');
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  setter?.call(inputs[1], 'example.com:8080');
  inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await evaluate(`document.querySelector('.dialog-footer .bh-button--primary')?.click()`);
await waitFor(`!document.querySelector('.dialog-panel')`);
await sleep(700);
const tree = await evaluate(
  `chrome.bookmarks.getTree().then((items) => items[0].children?.[0]?.children?.map((node) => ({ title: node.title, url: node.url })) ?? [])`,
);
const errors = events
  .filter((event) => event.method === 'Runtime.exceptionThrown')
  .map((event) => event.params?.exceptionDetails?.exception?.description ?? 'unknown');
console.log(
  JSON.stringify(
    {
      focusedInitially,
      focusAfterClose,
      tree,
      urlAccepted:
        tree.find((node) => node.title === 'Port Site')?.url ===
        'https://example.com:8080/',
      errors,
    },
    null,
    2,
  ),
);
socket.close();
