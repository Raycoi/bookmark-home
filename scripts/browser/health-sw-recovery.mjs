import http from 'node:http';
import { getExtensionId } from './lib/config.mjs';

const PORT = 9344;
const SERVER_PORT = 43123;
const EXTENSION_ID = await getExtensionId();
const STORAGE_KEY = 'bookmarkHome.health.state';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://example.test:${SERVER_PORT}`);
  requests.push({ method: req.method ?? '', pathname: url.pathname });
  if (url.pathname === '/slow') {
    setTimeout(() => {
      try {
        res.statusCode = 200;
        res.end(req.method === 'HEAD' ? undefined : 'slow');
      } catch { /* 继续等待 */ }
    }, 30_000);
    return;
  }
  res.statusCode = 200;
  res.end(req.method === 'HEAD' ? undefined : 'ok');
});
await new Promise((resolve) => server.listen(SERVER_PORT, '127.0.0.1', resolve));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pageTarget = targets.find(
  (target) => target.type === 'page' && target.url.startsWith(`chrome-extension://${EXTENSION_ID}/`),
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
async function getHealthState() {
  return evaluate(
    `chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)}).then((value) => value[${JSON.stringify(STORAGE_KEY)}] ?? null)`,
  );
}

await send('Page.enable');
await send('Runtime.enable');
await waitFor(`Boolean(document.querySelector('.health-entry'))`);
await evaluate(`chrome.storage.local.remove(${JSON.stringify(STORAGE_KEY)})`);
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
  return chrome.bookmarks.create({
    parentId: '1',
    title: 'Interrupted slow URL',
    url: 'http://example.test:${SERVER_PORT}/slow',
  });
})()`);

await sleep(500);
await evaluate(
  `chrome.runtime.sendMessage({ type: 'HEALTH_CHECK_ALL' })`,
);

let checkingState = null;
for (let attempt = 0; attempt < 150; attempt += 1) {
  const state = await getHealthState();
  if (state?.tasks?.some((task) => task.status === 'checking')) {
    checkingState = state;
    break;
  }
  await sleep(100);
}
if (!checkingState) throw new Error('没有进入 checking 状态，无法测试中断恢复');

await send('ServiceWorker.enable');
await sleep(400);
const versions = events
  .filter((event) => event.method === 'ServiceWorker.workerVersionUpdated')
  .flatMap((event) => event.params?.versions ?? []);
const worker = versions.find(
  (version) =>
    version.scriptURL === `chrome-extension://${EXTENSION_ID}/background.js` &&
    version.runningStatus === 'running',
);
if (!worker) {
  throw new Error(`找不到运行中的扩展 Service Worker: ${JSON.stringify(versions)}`);
}

await send('ServiceWorker.stopWorker', { versionId: worker.versionId });
await sleep(1_500);
const workerAfterStop = events
  .filter((event) => event.method === 'ServiceWorker.workerVersionUpdated')
  .flatMap((event) => event.params?.versions ?? [])
  .find((version) => version.versionId === worker.versionId);
const stateAfterStop = await getHealthState();

const wakeResponse = await evaluate(
  `chrome.runtime.sendMessage({ type: 'HEALTH_GET_SNAPSHOT' }).then((response) => ({ ok: response?.ok, pending: response?.snapshot?.pendingUrls, checking: response?.snapshot?.checkingUrls }))`,
);
await sleep(500);
const alarmsAfterWake = await evaluate(
  'chrome.alarms.getAll().then((items) => items.map((item) => item.name))',
);
const recoveredState = await getHealthState();
const recoveredTask = recoveredState?.tasks?.find(
  (task) => task.url === 'http://example.test:43123/slow',
);

const cancelResponse = await evaluate(
  `chrome.runtime.sendMessage({ type: 'HEALTH_CANCEL_SCAN' }).then((response) => response?.ok)`,
);
await sleep(500);
const finalState = await getHealthState();

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
  taskStartedChecking: {
    ok:
      checkingState.tasks.some(
        (task) =>
          task.url === 'http://example.test:43123/slow' &&
          task.status === 'checking',
      ),
    details: checkingState.tasks,
  },
  serviceWorkerInterrupted: {
    ok:
      stateAfterStop?.tasks?.some(
        (task) =>
          task.url === 'http://example.test:43123/slow' &&
          task.status === 'checking',
      ) === true &&
      recoveredTask?.recoveryCount >= 1,
    details: {
      versionId: worker.versionId,
      before: worker.runningStatus,
      after: workerAfterStop?.runningStatus ?? null,
      recoveryCount: recoveredTask?.recoveryCount ?? null,
    },
  },
  checkingSurvivesUntilWake: {
    ok:
      stateAfterStop?.tasks?.some(
        (task) =>
          task.url === 'http://example.test:43123/slow' &&
          task.status === 'checking',
      ) === true,
    details: stateAfterStop?.tasks ?? null,
  },
  wakeRecoversTask: {
    ok:
      wakeResponse?.ok === true &&
      recoveredTask?.status === 'pending' &&
      recoveredTask?.recoveryCount >= 1,
    details: { wakeResponse, recoveredTask },
  },
  alarmsSurviveWorkerStop: {
    ok:
      alarmsAfterWake.includes('bookmarkHome.health.tick') &&
      alarmsAfterWake.includes('bookmarkHome.health.maintenance'),
    details: alarmsAfterWake,
  },
  scanCancelledAfterRecovery: {
    ok:
      cancelResponse === true &&
      finalState?.scan?.status === 'cancelled' &&
      finalState?.tasks?.length === 0,
    details: { cancelResponse, scan: finalState?.scan, tasks: finalState?.tasks },
  },
  slowRequestWasInterrupted: {
    ok:
      requests.filter((request) => request.pathname === '/slow').length === 1,
    details: requests,
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
      worker: {
        versionId: worker.versionId,
        before: worker.runningStatus,
        after: workerAfterStop?.runningStatus ?? null,
      },
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
