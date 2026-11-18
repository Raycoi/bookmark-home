import http from 'node:http';

const PORT = 9344;
const SERVER_PORT = 43123;
const STORAGE_KEY = 'bookmarkHome.health.state';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://example.test:${SERVER_PORT}`);
  requests.push({ method: req.method ?? '', pathname: url.pathname });
  res.statusCode = 200;
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
async function waitFor(expression, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch { /* 继续等待 */ }
    await sleep(100);
  }
  throw new Error(`等待条件超时: ${expression}`);
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
    await sleep(100);
  }
  throw new Error(`等待扫描状态 ${status} 超时`);
}

await send('Page.enable');
await send('Runtime.enable');
await waitFor(`Boolean(document.querySelector('.health-entry'))`);
await evaluate(`chrome.storage.local.remove(${JSON.stringify(STORAGE_KEY)})`);
await sleep(200);

const urls = Array.from(
  { length: 21 },
  (_, index) => `http://example.test:${SERVER_PORT}/auto-${index}`,
);
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
  for (const url of ${JSON.stringify(urls)}) {
    await chrome.bookmarks.create({
      parentId: '1',
      title: url.split('/').pop(),
      url,
    });
  }
})()`);
await sleep(500);
await evaluate(`chrome.storage.local.remove(${JSON.stringify(STORAGE_KEY)})`);
await sleep(200);

await evaluate(`document.querySelector('.health-entry')?.click()`);
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dialog-panel button')].find((node) => node.textContent?.trim() === '全部检测');
  button?.click();
})()`);
const startedAt = Date.now();
const state = await waitScanStatus('completed', 30_000);
const elapsedMs = Date.now() - startedAt;
const tasks = state.tasks ?? [];
const records = state.records ?? {};
const autoRequests = requests.filter((request) =>
  request.pathname.startsWith('/auto-'),
);
const alarmNames = await evaluate(
  'chrome.alarms.getAll().then((items) => items.map((item) => item.name))',
);
const runtimeErrors = events
  .filter((event) => event.method === 'Runtime.exceptionThrown')
  .map((event) => event.params?.exceptionDetails?.exception?.description ?? 'unknown');

const checks = {
  scanCompleted: {
    ok:
      state.scan?.status === 'completed' &&
      state.scan?.total === 21 &&
      state.scan?.completed === 21,
    details: state.scan,
  },
  allRecordsWritten: {
    ok: Object.keys(records).length === 21,
    details: Object.keys(records).length,
  },
  noTasksLeft: {
    ok: tasks.length === 0,
    details: tasks,
  },
  eachUrlRequestedOnce: {
    ok:
      autoRequests.length === 21 &&
      new Set(autoRequests.map((request) => request.pathname)).size === 21,
    details: {
      count: autoRequests.length,
      unique: new Set(autoRequests.map((request) => request.pathname)).size,
    },
  },
  alarmsStillPresent: {
    ok:
      alarmNames.includes('bookmarkHome.health.tick') &&
      alarmNames.includes('bookmarkHome.health.maintenance'),
    details: alarmNames,
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
      elapsedMs,
      scan: state.scan,
      requestCount: autoRequests.length,
      failed: Object.entries(checks)
        .filter(([, value]) => !value.ok)
        .map(([key]) => key),
    },
    null,
    2,
  ),
);

server.closeAllConnections();
await new Promise((resolve) => server.close(resolve));
socket.close();
if (Object.values(checks).some((entry) => !entry.ok)) process.exitCode = 1;
