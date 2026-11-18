import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import { SHOT_DIR, getExtensionUrl } from './lib/config.mjs';

const PORT = 9344;
const SERVER_PORT = 43123;
const SERVER_HOST = 'example.test';
const EXTENSION_URL = await getExtensionUrl();
const STORAGE_KEY = 'bookmarkHome.health.state';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requests = [];
let flakyCount = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${SERVER_HOST}:${SERVER_PORT}`);
  requests.push({
    method: req.method ?? '',
    pathname: url.pathname,
    search: url.search,
    range: req.headers.range ?? null,
    at: Date.now(),
  });

  const path = url.pathname;
  if (path === '/redirect') {
    res.statusCode = 302;
    res.setHeader('Location', '/final');
    res.end();
    return;
  }
  if (path === '/nohead' && req.method === 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end();
    return;
  }
  if (path === '/flaky') {
    flakyCount += 1;
    res.statusCode = flakyCount === 1 ? 503 : 200;
    res.end(req.method === 'HEAD' ? undefined : 'flaky');
    return;
  }

  const statuses = {
    '/ok': 200,
    '/final': 200,
    '/missing': 404,
    '/forbidden': 403,
    '/gone': 410,
    '/server': 500,
    '/nohead': 200,
  };
  res.statusCode = statuses[path] ?? 200;
  res.end(req.method === 'HEAD' ? undefined : 'ok');
});

await new Promise((resolve) => server.listen(SERVER_PORT, '127.0.0.1', resolve));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pageTarget = targets.find((target) => target.type === 'page');
if (!pageTarget) throw new Error('找不到 Chrome 页面 target');
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
async function waitScanStatus(status, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await getHealthState();
    if (state?.scan?.status === status) return state;
    await sleep(200);
  }
  throw new Error(`等待扫描状态 ${status} 超时`);
}
async function getBookmarkTree() {
  return evaluate(`chrome.bookmarks.getTree()`);
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
function healthyRequestCount() {
  return requests.filter(
    (request) =>
      ['/ok', '/final', '/missing', '/forbidden', '/gone', '/server', '/nohead', '/flaky'].includes(
        request.pathname,
      ) ||
      request.pathname.startsWith('/unknown'),
  );
}
function countPath(pathname, search = '') {
  return requests.filter(
    (request) => request.pathname === pathname && request.search === search,
  ).length;
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
await sleep(300);

const seeded = await evaluate(`(async () => {
  async function clearSection(id) {
    const tree = await chrome.bookmarks.getSubTree(id);
    for (const child of tree[0]?.children ?? []) {
      if (child.url) await chrome.bookmarks.remove(child.id);
      else await chrome.bookmarks.removeTree(child.id);
    }
  }
  const create = (title, url) => chrome.bookmarks.create({ parentId: '1', title, url });
  await clearSection('1');
  await clearSection('2');

  const ok1 = await create('OK one', 'http://${SERVER_HOST}:${SERVER_PORT}/ok');
  const ok2 = await create('OK duplicate', 'http://${SERVER_HOST}:${SERVER_PORT}/ok');
  const okQuery = await create('OK query', 'http://${SERVER_HOST}:${SERVER_PORT}/ok?x=1');
  const missing = await create('Missing', 'http://${SERVER_HOST}:${SERVER_PORT}/missing');
  const forbidden = await create('Forbidden', 'http://${SERVER_HOST}:${SERVER_PORT}/forbidden');
  const gone = await create('Gone', 'http://${SERVER_HOST}:${SERVER_PORT}/gone');
  const serverError = await create('Server error', 'http://${SERVER_HOST}:${SERVER_PORT}/server');
  const redirect = await create('Redirect', 'http://${SERVER_HOST}:${SERVER_PORT}/redirect');
  const nohead = await create('No HEAD', 'http://${SERVER_HOST}:${SERVER_PORT}/nohead');
  const flaky = await create('Flaky', 'http://${SERVER_HOST}:${SERVER_PORT}/flaky');
  const network = await create('Network error', 'http://example.test:43124/network');

  let unsupported = null;
  try {
    unsupported = await create('Unsupported', 'chrome://settings/');
  } catch { /* 继续等待 */ }

  return {
    ok1: ok1.id,
    ok2: ok2.id,
    okQuery: okQuery.id,
    missing: missing.id,
    forbidden: forbidden.id,
    gone: gone.id,
    serverError: serverError.id,
    redirect: redirect.id,
    nohead: nohead.id,
    flaky: flaky.id,
    network: network.id,
    unsupported: unsupported?.id ?? null,
  };
})()`);

await waitFor(`document.querySelectorAll('.bookmark-entry').length >= 11`);
await sleep(900);

const treeBefore = flattenBookmarks((await getBookmarkTree())[0]);
const requestsBeforePanel = healthyRequestCount().length;

// 打开面板本身不触发检测
await evaluate(`Boolean(document.querySelector('.health-entry'))`);
await evaluate(`document.querySelector('.health-entry')?.click()`);
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await sleep(500);
const requestsAfterPanel = healthyRequestCount().length;

const panelInitial = await evaluate(`({
  title: document.querySelector('.dialog-title')?.textContent?.trim(),
  summary: document.querySelector('.health-summary')?.textContent?.replace(/\\s+/g, ' ').trim(),
  loading: Boolean(document.querySelector('.health-empty')),
  filterLabels: [...document.querySelectorAll('.health-filter__button')].map((node) => node.textContent?.replace(/\\s+/g, ' ').trim()),
})`);
const panelShot = await capture('phase-4-health-panel-before.png');

// 用户点击全部检测
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dialog-panel button')].find((node) => node.textContent?.trim() === '全部检测');
  button?.click();
})()`);

await waitFor(`Boolean(document.querySelector('.health-progress'))`, 5_000).catch(() => undefined);
const progressSeen = await evaluate(`Boolean(document.querySelector('.health-progress'))`);
const progressShot = progressSeen ? await capture('phase-4-health-progress.png') : null;

const completedState = await waitScanStatus('completed', 60_000);
await waitFor(`!document.querySelector('.health-progress')`, 10_000);
await sleep(500);

const firstScanCounts = {
  ok: countPath('/ok'),
  okQuery: countPath('/ok', '?x=1'),
  nohead: countPath('/nohead'),
  server: countPath('/server'),
  flaky: countPath('/flaky'),
  missing: countPath('/missing'),
};

const records = completedState.records;
const okRecord = records['http://example.test:43123/ok'];
const queryRecord = records['http://example.test:43123/ok?x=1'];
const missingRecord = records['http://example.test:43123/missing'];
const forbiddenRecord = records['http://example.test:43123/forbidden'];
const goneRecord = records['http://example.test:43123/gone'];
const serverRecord = records['http://example.test:43123/server'];
const redirectRecord = records['http://example.test:43123/redirect'];
const noheadRecord = records['http://example.test:43123/nohead'];
const flakyRecord = records['http://example.test:43123/flaky'];
const networkRecord = records['http://example.test:43124/network'];

const panelCompleted = await evaluate(`({
  summary: document.querySelector('.health-summary')?.textContent?.replace(/\\s+/g, ' ').trim(),
  rows: document.querySelectorAll('.health-row').length,
})`);
const completedShot = await capture('phase-4-health-panel-complete.png');

// 异常筛选
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.health-filter__button')].find((node) => node.textContent?.trim().startsWith('异常'));
  button?.click();
})()`);
await sleep(200);
const abnormalFilter = await evaluate(`({
  rows: document.querySelectorAll('.health-row').length,
  labels: [...document.querySelectorAll('.health-row__status')].map((node) => node.textContent?.trim()),
})`);
const abnormalShot = await capture('phase-4-health-abnormal-filter.png');
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.health-filter__button')].find((node) => node.textContent?.trim().startsWith('全部'));
  button?.click();
})()`);

// 单站重检
const beforeMissingRequests = countPath('/missing');
const beforeMissingCheckedAt = missingRecord?.checkedAt ?? 0;
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.health-row')].find((node) => node.querySelector('.health-row__url')?.textContent?.includes('/missing'));
  row?.querySelector('.health-row__recheck')?.click();
})()`);
await waitFor(
  `chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)}).then((value) => {
    const state = value[${JSON.stringify(STORAGE_KEY)}];
    const record = state?.records?.['http://example.test:43123/missing'];
    return Boolean(record && record.checkedAt > ${beforeMissingCheckedAt});
  })`,
  15_000,
);
const afterRecheckMissingRequests = countPath('/missing');

// 收起面板，点击书签状态点查看详情
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dialog-footer button')].find((node) => node.textContent?.trim() === '关闭');
  button?.click();
})()`);
await waitFor(`!document.querySelector('.dialog-panel')`);
await evaluate(`window.scrollTo({ top: document.querySelector('.home__browse')?.offsetTop ? document.querySelector('.home__browse').offsetTop - 20 : 0, behavior: 'instant' })`);
await sleep(200);
await evaluate(`(() => {
  const entry = [...document.querySelectorAll('.bookmark-entry')].find((node) => node.querySelector('.bookmark-name')?.textContent?.trim() === 'Missing');
  entry?.querySelector('.health-indicator')?.click();
})()`);
await waitFor(`Boolean(document.querySelector('.health-detail'))`);
await sleep(250);
const detailInfo = await evaluate(`({
  text: document.querySelector('.health-detail')?.textContent?.replace(/\\s+/g, ' ').trim(),
  visible: Boolean(document.querySelector('.health-detail')),
})`);
const detailShot = await capture('phase-4-health-detail.png');
await evaluate(`document.querySelector('.health-detail__close')?.click()`);
await waitFor(`!document.querySelector('.health-detail')`);
await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
await sleep(200);

// 再次打开面板并取消一次全量任务
await evaluate(`document.querySelector('.health-entry')?.click()`);
await waitFor(`Boolean(document.querySelector('.dialog-panel'))`);
await sleep(250);
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dialog-panel button')].find((node) => node.textContent?.trim() === '全部检测');
  button?.click();
})()`);
await waitFor(`Boolean(document.querySelector('.health-progress'))`, 5_000);
const cancelShot = await capture('phase-4-health-cancel-progress.png');
await evaluate(`document.querySelector('.health-progress__cancel')?.click()`);
await waitScanStatus('cancelled', 15_000);
await sleep(5_000);
const cancelledState = await getHealthState();
await evaluate(`(() => {
  const button = [...document.querySelectorAll('.dialog-footer button')].find((node) => node.textContent?.trim() === '关闭');
  button?.click();
})()`);
await waitFor(`!document.querySelector('.dialog-panel')`);

// 重新加载新标签页：只读缓存，不触发检测
const requestsBeforeReload = healthyRequestCount().length;
await send('Page.reload');
await waitFor(`Boolean(document.querySelector('.health-entry'))`);
await waitFor(`document.querySelectorAll('.health-indicator').length >= 10`);
await sleep(1_200);
const requestsAfterReload = healthyRequestCount().length;
const reloadDots = await evaluate(`document.querySelectorAll('.health-indicator').length`);

// 新增书签自动入队（延迟约 5 秒）
const newBookmark = await evaluate(`(async () => {
  const created = await chrome.bookmarks.create({
    parentId: '1',
    title: 'Auto queued',
    url: 'http://${SERVER_HOST}:${SERVER_PORT}/auto-queued',
  });
  return created.id;
})()`);
await sleep(900);
const afterCreateState = await getHealthState();
const autoTask = afterCreateState?.tasks?.find((task) =>
  task.url === 'http://example.test:43123/auto-queued',
);

// 删除书签后清理任务（1.5s 本地清理 + 1min 兜底 alarm）
await evaluate(`chrome.bookmarks.remove(${JSON.stringify(newBookmark)})`);
await sleep(2_500);
const afterDeleteState = await getHealthState();
const autoTaskAfterDelete = afterDeleteState?.tasks?.find((task) =>
  task.url === 'http://example.test:43123/auto-queued',
);

// 权限/alarms 与原生书签不变
const alarms = await evaluate(`chrome.alarms.getAll().then((items) => items.map((item) => ({ name: item.name, periodInMinutes: item.periodInMinutes ?? null })))`);
const treeAfter = flattenBookmarks((await getBookmarkTree())[0]);
const treeUnchanged = JSON.stringify(treeBefore) === JSON.stringify(treeAfter);

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
  panelOpened: {
    ok: panelInitial.title === '网站健康' && Boolean(panelInitial.summary),
    details: panelInitial,
  },
  panelDoesNotTriggerDetection: {
    ok: requestsBeforePanel === requestsAfterPanel,
    details: { requestsBeforePanel, requestsAfterPanel },
  },
  allStatusesMapped: {
    ok:
      okRecord?.status === 'healthy' &&
      queryRecord?.status === 'healthy' &&
      missingRecord?.status === 'not_found' &&
      forbiddenRecord?.status === 'restricted' &&
      goneRecord?.status === 'gone' &&
      serverRecord?.status === 'server_error' &&
      redirectRecord?.status === 'redirected' &&
      noheadRecord?.status === 'healthy' &&
      flakyRecord?.status === 'healthy' &&
      networkRecord?.status === 'unknown',
    details: {
      ok: okRecord?.status,
      query: queryRecord?.status,
      missing: missingRecord?.status,
      forbidden: forbiddenRecord?.status,
      gone: goneRecord?.status,
      server: serverRecord?.status,
      redirect: redirectRecord?.status,
      nohead: noheadRecord?.status,
      flaky: flakyRecord?.status,
      network: networkRecord?.status,
    },
  },
  headAndGetFallback: {
    ok:
      noheadRecord?.method === 'GET' &&
      firstScanCounts.nohead === 2 &&
      requests.some(
        (request) =>
          request.pathname === '/nohead' &&
          request.method === 'GET' &&
          request.range === 'bytes=0-0',
      ),
    details: { noheadRecord, noheadRequests: firstScanCounts.nohead },
  },
  redirectFinalUrl: {
    ok:
      redirectRecord?.httpStatus === 200 &&
      redirectRecord?.finalUrl === 'http://example.test:43123/final',
    details: redirectRecord,
  },
  retryBehavior: {
    ok:
      serverRecord?.retryCount === 1 &&
      flakyRecord?.retryCount === 1 &&
      firstScanCounts.server === 2 &&
      firstScanCounts.flaky === 2,
    details: {
      serverRecord,
      flakyRecord,
      serverRequests: firstScanCounts.server,
      flakyRequests: firstScanCounts.flaky,
    },
  },
  duplicateUrlSharesCache: {
    ok:
      firstScanCounts.ok === 1 &&
      firstScanCounts.okQuery === 1 &&
      Boolean(records['http://example.test:43123/ok']) &&
      Boolean(records['http://example.test:43123/ok?x=1']),
    details: {
      okRequests: firstScanCounts.ok,
      okQueryRequests: firstScanCounts.okQuery,
      uniqueRecords: Object.keys(records).length,
    },
  },
  uiStatusCounts: {
    ok:
      panelCompleted.summary?.includes(`共 ${seeded.unsupported ? 11 : 10} 个网址`) &&
      panelCompleted.summary?.includes('正常 5') &&
      panelCompleted.summary?.includes('异常 4') &&
      panelCompleted.summary?.includes('无法确认 1') &&
      (!seeded.unsupported || panelCompleted.summary?.includes('无法检测 1')),
    details: panelCompleted,
  },
  abnormalFilter: {
    ok:
      abnormalFilter.rows === 4 &&
      abnormalFilter.labels.every((label) =>
        ['页面不存在', '访问受限', '页面已移除', '服务器异常'].includes(label),
      ),
    details: abnormalFilter,
  },
  recheckSingleUrl: {
    ok:
      afterRecheckMissingRequests === beforeMissingRequests + 1,
    details: {
      beforeMissingRequests,
      afterRecheckMissingRequests,
      finalMissingRequests: countPath('/missing'),
    },
  },
  detailPopover: {
    ok:
      detailInfo.visible &&
      detailInfo.text.includes('页面不存在') &&
      detailInfo.text.includes('404') &&
      detailInfo.text.includes('重新检测'),
    details: detailInfo,
  },
  progressAndCancel: {
    ok: Boolean(progressSeen) && cancelledState?.scan?.status === 'cancelled',
    details: { progressSeen, cancelledScan: cancelledState?.scan },
  },
  reloadDoesNotCheck: {
    ok: requestsAfterReload === requestsBeforeReload && reloadDots >= 10,
    details: { requestsBeforeReload, requestsAfterReload, reloadDots },
  },
  newBookmarkQueued: {
    ok:
      autoTask?.source === 'bookmark_created' &&
      autoTask?.notBefore >= autoTask?.createdAt + 4_000,
    details: autoTask,
  },
  deleteCleansTask: {
    ok: autoTaskAfterDelete === undefined,
    details: autoTaskAfterDelete ?? null,
  },
  alarmsRegistered: {
    ok:
      alarms.some((alarm) => alarm.name === 'bookmarkHome.health.tick') &&
      alarms.some((alarm) => alarm.name === 'bookmarkHome.health.maintenance'),
    details: alarms,
  },
  nativeBookmarksUnchanged: {
    ok: treeUnchanged,
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
      records: Object.fromEntries(
        Object.entries(records).map(([url, record]) => [
          url,
          {
            status: record.status,
            httpStatus: record.httpStatus,
            finalUrl: record.finalUrl,
            method: record.method,
            retryCount: record.retryCount,
          },
        ]),
      ),
      requestSummary: {
        total: requests.length,
        health: healthyRequestCount().length,
        byPath: Object.fromEntries(
          [...new Set(requests.map((request) => request.pathname))].map((path) => [
            path,
            requests.filter((request) => request.pathname === path).length,
          ]),
        ),
      },
      screenshots: {
        panelBefore: panelShot,
        progress: progressShot,
        panelComplete: completedShot,
        abnormalFilter: abnormalShot,
        detail: detailShot,
        cancel: cancelShot,
      },
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
