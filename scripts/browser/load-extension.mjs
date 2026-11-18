import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, STATE_FILE } from './lib/config.mjs';

const PORT = 9344;
const extensionPath = path.join(ROOT, '.output', 'chrome-mv3');

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const browserSocket = new WebSocket(version.webSocketDebuggerUrl);
const browserPending = new Map();
let browserId = 1;
browserSocket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const waiter = browserPending.get(message.id);
  if (!waiter) return;
  browserPending.delete(message.id);
  message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
};
await new Promise((resolve, reject) => {
  browserSocket.onopen = resolve;
  browserSocket.onerror = reject;
});
function browserSend(method, params = {}) {
  const id = browserId++;
  return new Promise((resolve, reject) => {
    browserPending.set(id, { resolve, reject });
    browserSocket.send(JSON.stringify({ id, method, params }));
  });
}

let extensionId;
try {
  const loaded = await browserSend('Extensions.loadUnpacked', { path: extensionPath });
  extensionId = loaded.id;
  await writeFile(
    STATE_FILE,
    `${JSON.stringify({ extensionId, loadedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
  console.log('LOADED', JSON.stringify(loaded));
} finally {
  browserSocket.close();
}

await new Promise((resolve) => setTimeout(resolve, 500));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((target) => target.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
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

const targetUrl = `chrome-extension://${extensionId}/newtab.html`;
console.log('NAVIGATE', targetUrl);
console.log('NAV RESULT', JSON.stringify(await send('Page.navigate', { url: targetUrl })));
await new Promise((resolve) => setTimeout(resolve, 2500));
const result = await send('Runtime.evaluate', {
  expression: `({
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    text: document.body?.innerText?.slice(0, 1500),
    hasPhasePage: Boolean(document.querySelector('.phase-page')),
    hasChrome: typeof chrome !== 'undefined',
    hasBookmarks: typeof chrome !== 'undefined' && Boolean(chrome.bookmarks),
    bodyClass: document.body?.className
  })`,
  returnByValue: true,
});
console.log(JSON.stringify(result.result.value, null, 2));
socket.close();
