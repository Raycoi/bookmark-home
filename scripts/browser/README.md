# 真实 Chrome 测试

这些脚本使用 Chrome DevTools Protocol 驱动已加载的扩展，验证真实
`chrome.bookmarks`、真实页面和真实 Service Worker。

## 前置条件

1. 已安装 Chrome（测试基准为 Chrome 157）。
2. 在项目根目录安装依赖并构建：

```bash
pnpm install
pnpm build
```

3. 启动一个独立的 Chrome 配置，并打开远程调试：

```powershell
$profile = "$PWD\.tmp\bh-e2e-profile"
New-Item -ItemType Directory -Force -Path $profile | Out-Null
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new `
  --no-sandbox `
  --disable-gpu `
  --enable-unsafe-extension-debugging `
  --no-first-run `
  --no-default-browser-check `
  --no-proxy-server `
  --host-resolver-rules="MAP example.test 127.0.0.1" `
  --remote-debugging-port=9344 `
  --user-data-dir=$profile `
  chrome://newtab/
```

4. 加载扩展：

```bash
node scripts/browser/load-extension.mjs
```

脚本会把扩展 ID 写入项目根目录的 `.e2e-state.json`（已被 `.gitignore` 忽略）。
如果手动加载扩展，可以设置：

```powershell
$env:E2E_EXTENSION_ID = "你的扩展 ID"
```

## 运行

在项目根目录执行：

```bash
node scripts/browser/bookmark-crud.mjs
node scripts/browser/bookmark-drag.mjs
node scripts/browser/bookmark-port-focus.mjs
node scripts/browser/health-core.mjs
node scripts/browser/health-protection.mjs
node scripts/browser/health-sw-recovery.mjs
node scripts/browser/health-auto-continue.mjs
```

每个脚本会启动并关闭自己的本机 HTTP 测试服务（端口 `43123`），
把截图写入 `.tmp/browser-shots/`，并以 JSON 输出检查结果；失败时退出码非 0。

| 脚本 | 覆盖 |
|---|---|
| `bookmark-crud.mjs` | 新增/编辑/删除/移动/文件夹/菜单/重载 |
| `bookmark-drag.mjs` | 书签/文件夹拖拽、插入线、投放高亮、重载顺序 |
| `bookmark-port-focus.mjs` | `example.com:8080` 新增、对话框焦点恢复 |
| `health-core.mjs` | 健康状态、HEAD→GET、重试、进度、详情、取消 |
| `health-protection.mjs` | 429、内网保护、筛选 |
| `health-sw-recovery.mjs` | Worker 终止、`checking` 恢复、alarm 持久性 |
| `health-auto-continue.mjs` | 21 个任务自动续跑，每轮最多 10 |

## CI 边界

这些脚本默认只在本地真实 Chrome 中运行，不放入普通 GitHub Actions runner：

- `Extensions.loadUnpacked`、`ServiceWorker.stopWorker` 和真实扩展 Service Worker
  的 CDP 行为依赖真实 Chrome 版本和 runner 环境，GitHub 托管 runner 不能保证稳定。
- 测试需要 `example.test` 的 host resolver 映射、临时 HTTP 服务和独立 Chrome 用户
  配置。
- Chrome 原生“导入书签”文件选择器不是网页 `<input>`，CDP 无法拦截，必须人工验证。

因此 CI 负责 lint、typecheck、unit test、生产构建、ZIP 和产物校验；真实 Chrome
回归在本地执行，不能用单元测试冒充。Playwright + Chromium 也评估过，但它不能
稳定替代本项目的扩展 Service Worker 终止和原生导入检查，因此没有为了 CI 通过而
删除这些真实测试。

## 导入书签事件

Chrome 的“导入书签”使用浏览器原生文件选择器，CDP 无法拦截这个原生对话框。
因此 `onImportEnded` 的真实 UI 导入不能由本目录脚本可靠自动化；调度器入队逻辑由
`tests/healthScheduler.test.ts` 覆盖空、单个、多个、重复、非 HTTP/内网和缓存新鲜度。

人工验证步骤：

1. 用 `scripts/browser/fixtures/import-bookmarks.html` 作为导入文件。
2. 打开 `chrome://bookmarks`，菜单 → 导入书签。
3. 导入后打开扩展新标签页，确认健康面板出现导入的 HTTP/HTTPS 书签，
   私网/非 HTTP 地址不出现，已完成记录不会重复入队。
4. 确认导入后至少 5 秒内没有立即发起大量请求；任务按每轮 10 个、全局 3、
   同域 1 的既有策略处理。
