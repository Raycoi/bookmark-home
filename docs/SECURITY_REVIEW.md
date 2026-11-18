# Bookmark Home 安全审查

审查日期：2026-11-18  
审查范围：`main`（基线 `38b7f08` 之后的发布准备改动）  
审查对象：生产构建、Service Worker、Chrome API 使用、网络请求、存储、消息和
依赖。

## 1. 结论摘要

未发现硬编码密钥、远程脚本、内容脚本注入、`eval`/`new Function`、`v-html`/
`innerHTML` 等明显高危执行面。当前主要风险是健康检查的广泛主机权限和网络边界，
这些是产品功能所需的已知取舍，已在权限说明、隐私政策和 README 中披露。

当前没有确认的 P0 安全问题。

## 2. 权限与最小化

| 权限 | 是否必要 | 说明 |
|---|---|---|
| `bookmarks` | 是 | 唯一书签数据源 |
| `storage` | 是 | 搜索偏好和本地健康缓存 |
| `favicon` | 是 | Chrome 本地图标 |
| `alarms` | 是 | 后台调度和清理 |
| `host_permissions: <all_urls>` | 是 | 对用户书签中的任意站点做健康检查 |

扩展没有：

- 内容脚本；
- `tabs`、`history`、`cookies`、`webRequest`、`scripting` 权限；
- 远程代码加载；
- 第三方统计或广告 SDK；
- 外部消息接口（`externally_connectable`）。

## 3. 网络请求

生产代码中的网络请求只有：

1. 健康检查 `fetch`，目标为书签 HTTP/HTTPS URL；
2. 用户主动搜索时跳转搜索引擎；
3. Chrome `_favicon` 本地接口；
4. Chrome 加载扩展自身资源。

健康检查：

- `credentials: "omit"`，不携带 Cookie；
- `cache: "no-store"`；
- `referrerPolicy: "no-referrer"`；
- 只读响应状态和最终 URL，随后取消响应体；
- 10 秒超时，`AbortController`；
- 不读取页面正文；
- 不向开发者服务器发送 URL。

### 已知边界：重定向和 DNS

内网保护只检查 URL 字面主机名，不解析 DNS。公网域名解析到私网 IP，或公网页面
重定向到内网地址，可能进入浏览器网络层。这是已知边界，未声称完全阻止 DNS
rebinding 或所有重定向型内网探测。隐私政策和 README 已披露。

## 4. 存储

- `chrome.storage.sync`：只有 `bookmarkHome.searchEngineId`。
- `chrome.storage.local`：只有 `bookmarkHome.health.state`，含 URL、状态、跳转
  地址、任务和扫描进度；不保存书签树、标题、Cookie 或历史。
- 健康记录在书签不再被引用后最多保留 30 天。
- 不建立独立书签数据库，不保存离线书签副本。

## 5. 输入与输出安全

- 书签新增/编辑只接受 `http:`/`https:`；拒绝 `javascript:`、`data:`、`file:` 等。
- 主页导航使用 `getNavigableUrl()`，只允许 HTTP/HTTPS。
- Vue 模板默认转义；代码中没有 `v-html`、`innerHTML`、`outerHTML`、
  `insertAdjacentHTML`、`eval` 或 `new Function`。
- favicon URL 使用 `encodeURIComponent`。
- 搜索 URL 从固定的引擎模板生成，查询词编码，不允许任意 URL 注入。
- 书签标题和 URL 作为文本渲染，不作为 HTML 执行。

## 6. 消息与后台

- `chrome.runtime.onMessage` 只处理带已知 `HEALTH_*` 类型的消息，其他消息返回
  `false`。
- 没有 `externally_connectable`，网页和其他扩展不能直接使用该消息接口。
- 消息处理器只暴露快照读取、扫描、重检和取消；没有任意 API 代理。
- 后台初始化失败会重新尝试；异步错误记录警告，不静默吞掉用户可见状态。
- `onAlarm` 返回 Promise 只是额外保持生命周期的尝试，不作为唯一安全保证；已有
  `checking → pending` 恢复和 alarm 兜底。

## 7. 日志

- 日志不打印书签标题、书签树或健康检查 URL；
- 导入日志只打印 URL 数量；
- 错误日志使用通用错误消息，不主动拼接书签 URL；
- 没有把健康检查结果写入网页或第三方服务。

低风险：Chrome API 返回的底层错误字符串可能包含浏览器提供的上下文；扩展没有
主动把该字符串发送到远端。

## 8. 依赖与供应链

- 运行时依赖只有 `vue`。
- 开发依赖包括 WXT、Vite、Vitest、ESLint、TypeScript、vue-tsc 和 `fflate`
  （仅构建产物校验）。
- 构建脚本没有下载或执行远程代码。
- `pnpm-lock.yaml` 被提交，CI 使用 `--frozen-lockfile`。

依赖审计结果（2026-11-18）：

- `pnpm audit --prod`：0 个漏洞。
- `pnpm audit`：2 个 high，均来自开发链路中的 `picomatch`（经
  `eslint-plugin-vue → typescript-eslint` 和 `wxt → rollup-plugin-visualizer`）。
  当前审计数据没有提供可用的 patched 版本；`picomatch` 不进入生产扩展 ZIP，
  因此不构成运行时依赖漏洞。构建工具链升级时继续跟踪。


## 9. 构建产物

`scripts/verify-extension.mjs` 检查：

- Manifest V3；
- package.json 与 manifest 版本一致；
- 权限和 host_permissions 与预期一致；
- Service Worker、New Tab 入口和图标存在；
- ZIP 根目录有 `manifest.json`、`background.js`、`newtab.html`；
- 没有外层项目文件夹；
- 没有 node_modules、tests、src、scripts、docs、.github、source map、日志和本地
  状态文件；
- 生成 SHA-256 和 build report。

## 10. 未解决/待确认

- 原生 Chrome 文件选择器导入无法由 CDP 自动验证，需要人工导入测试。
- 未观察完整 1 分钟 alarm 周期下的长任务。
- 内网保护不做 DNS 解析，不阻止重定向到内网；这是已披露边界。
- 需在 GitHub Actions 远端首次运行后确认 CI 环境行为。
- 需由维护者确认真实支持联系方式（当前使用 GitHub 渠道，不虚构邮箱）。
