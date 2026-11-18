import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import { SHOT_DIR, getExtensionUrl } from './lib/config.mjs';

const PORT = 9344;
const SERVER_PORT = 43123;
const EXTENSION_URL = await getExtensionUrl();
const STORAGE_KEY = 'bookmarkHome.health.state';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://example.test:${SERVER_PORT}`);
  requests.push({ method: req.method ?? '', pathname: url.pathname, search: url.search });
  const statuses = { '/ok': 200, '/mobile': 200, '/private': 200, '/ratelimit': 429 };
  res.statusCode = statuses[url.pathname] ?? 200;
  res.end(req.method === 'HEAD' ? undefined : 'ok');
});
await new Promise((resolve) => server.listen(SERVER_PORT, '127.0.0.1', resolve));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pageTarget = targets.find(
  (target) => target.type === 'page' && target.url.startsWith('chrome-extension://'),
);
if (!pageTarget) throw new Error('找不到扩展页面 target');
const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let nextId = 1;

process.on('unhandledRejection', (error) => {
  console.error('UNHANDLED', error);
  server.close();
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error);
  server.close();
  process.exit(1);
});

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
async function waitFor(expression, timeout = 15_000) {
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
async function getHealthState() {
  return evaluate(
    `chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)}).then((value) => value[${JSON.stringify(STORAGE_KEY)}] ?? null)`,
  );
}
async function waitScanStatus(status, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await getHealthState();
    if (state?.scan?.status === status) return state;
    await sleep(150);
  }
  throw new Error(`等待扫描状态 ${status} 超时`);
}
function countPath(pathname) {
  return requests.filter((request) => request.pathname === pathname).length;
}
function flattenBookmarks(node) {
  const result = [];
  const visit = (current) => {
    if (current.url) {
      result.push({
        id: current.id,
        parentId: current.parentId,
        index: current.index,
        title: current.title,
        url: current.url,
      });
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return result;
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
await waitFor(`Boolean(document.querySelector('.health-entry'))`);
await evaluate(`chrome.storage.local.remove(${JSON.stringify(STORAGE_KEY)})`);
await evaluate(`chrome.alarms.clearAll()`);
await sleep(300);

const seeded = await evaluate(`(async () => {
  async function clearSection(id) {
    const tree = await chrome.bookmarks.getSubTree(id);
    for (const child of tree[0]?.children ?? []) {
      if (child.url) await chrome.bookmarks.remove(child.id);
      else await chrome.bookmarks.removeTree(child.id);
    }
  }
  await clearSection('1');
  await clearSection('2');

  const ok = await chrome.bookmarks.create({
    parentId: '1',
    title: 'Public OK',
    url: 'http://example.test:${SERVER_PORT}/ok',
  });
  const ratelimit = await chrome.bookmarks.create({
    parentId: '1',
    title: 'Rate limited',
    url: 'http://example.test:${SERVER_PORT}/ratelimit',
  });
  const privateBookmark = await chrome.bookmarks.create({
    parentId: '1',
    title: 'Private local',
    url: 'http://127.0.0.1:${SERVER_PORT}/private',
  });
  return {
    ok: ok.id,
    ratelimit: ratelimit.id,
    private: privateBookmark.id,
  };
})()`);

await waitFor(`document.querySelectorAll('.bookmark-entry').length >= 3`);
await sleep(700);
const treeBefore = flattenBookmarks((await evaluate('chrome.bookmarks.getTree()'))[0]);

const requestsBeforePanel = requests.filter((request) =>
  ['/ok', '/ratelimit', '/private', '/mobile'].includes(request.pathname),
).length;
await evaluate(`document.querySelector('.health-entry')?.click()`);
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await sleep(500);
const requestsAfterPanel = requests.filter((request) =>
  ['/ok', '/ratelimit', '/private', '/mobile'].includes(request.pathname),
).length;

const panelBefore = await evaluate(`({
  summary: document.querySelector('.health-summary')?.textContent?.replace(/\\s+/g, ' ').trim(),
  filters: [...document.querySelectorAll('.health-filter__button')].map((node) => node.textContent?.replace(/\\s+/g, ' ').trim()),
})`);

await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dialog-panel button')].find((node) => node.textContent?.trim() === '全部检测');
  button?.click();
})()`);
await waitScanStatus('completed', 30_000);
await waitFor(`!document.querySelector('.health-progress')`, 10_000);
await sleep(400);

const state = await getHealthState();
const records = state.records;
const rateRecord = records['http://example.test:43123/ratelimit'];
const privateRecord = records['http://127.0.0.1:43123/private'];
const summary = await evaluate(
  `document.querySelector('.health-summary')?.textContent?.replace(/\\s+/g, ' ').trim()`,
);
const dots = await evaluate(`({
  all: document.querySelectorAll('.health-indicator').length,
  privateDots: document.querySelectorAll('.health-indicator--status-private').length,
})`);

// 内网筛选
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.health-filter__button')].find((node) => node.textContent?.trim().startsWith('内网'));
  button?.click();
})()`);
await sleep(200);
const privateView = await evaluate(`({
  rows: document.querySelectorAll('.health-row').length,
  status: document.querySelector('.health-row__status')?.textContent?.trim(),
  recheckDisabled: document.querySelector('.health-row__recheck')?.disabled,
  url: document.querySelector('.health-row__url')?.textContent?.trim(),
})`);
const privateShot = await capture('phase-4-health-private.png');

const treeAfter = flattenBookmarks((await evaluate('chrome.bookmarks.getTree()'))[0]);
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

const checks = {
  panelDoesNotTriggerDetection: {
    ok: requestsBeforePanel === requestsAfterPanel,
    details: { requestsBeforePanel, requestsAfterPanel },
  },
  privateAddressBlocked: {
    ok:
      privateRecord === undefined &&
      countPath('/private') === 0 &&
      privateView.status === '内网地址' &&
      privateView.recheckDisabled === true &&
      dots.privateDots === 1,
    details: { privateRecord, privateRequests: countPath('/private'), privateView, dots },
  },
  rateLimitMappedToRestricted: {
    ok:
      rateRecord?.status === 'restricted' &&
      rateRecord?.httpStatus === 429 &&
      rateRecord?.method === 'HEAD' &&
      countPath('/ratelimit') === 1,
    details: { rateRecord, requests: countPath('/ratelimit') },
  },
  uiCounts: {
    ok:
      summary?.includes(`共 ${Object.keys(records).length + 1} 个网址`) &&
      summary?.includes('正常 1') &&
      summary?.includes('异常 1') &&
      summary?.includes('无法确认 0') &&
      summary?.includes('内网地址 1'),
    details: { summary, panelBefore },
  },
  nativeBookmarksUnchanged: {
    ok: JSON.stringify(treeBefore) === JSON.stringify(treeAfter),
    details: { before: treeBefore.length, after: treeAfter.length },
  },
  noRuntimeErrors: {
    ok: runtimeErrors.length === 0,
    details: runtimeErrors,
  },
};

console.log(
  JSON.stringify(
    {
      checks,
      seeded,
      summary,
      records: Object.fromEntries(
        Object.entries(records).map(([url, record]) => [
          url,
          {
            status: record.status,
            httpStatus: record.httpStatus,
            method: record.method,
            retryCount: record.retryCount,
          },
        ]),
      ),
      requests: {
        total: requests.length,
        private: countPath('/private'),
        ratelimit: countPath('/ratelimit'),
      },
      screenshots: { private: privateShot },
      failed: Object.entries(checks)
        .filter(([, value]) => !value.ok)
        .map(([key]) => key),
    },
    null,
    2,
  ),
);

await new Promise((resolve) => server.close(resolve));
socket.close();
if (Object.values(checks).some((entry) => !entry.ok)) process.exitCode = 1;
