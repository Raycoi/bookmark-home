# 技术架构

本文记录 Bookmark Home 的实现边界、数据流和后台机制。面向维护者，不是普通用户文档。

## 1. 总体结构

- WXT 生成 Chrome Manifest V3 扩展。
- 新标签页是 Vue 3 + TypeScript 页面。
- 后台是 MV3 Service Worker，使用 `chrome.bookmarks`、`chrome.storage` 和
  `chrome.alarms`。
- 不建立独立书签数据库，不复制书签树到扩展存储。
- 仓库中只有 Chrome 构建；没有 Firefox、Edge 或 Safari 版本。

```text
Chrome Bookmarks API
        │
        ├── 新标签页读取/展示
        ├── 用户写操作直接写回 Chrome
        └── 可选健康检查：读取 URL，写本地缓存

chrome.storage.sync   → 搜索引擎偏好
chrome.storage.local  → 健康检查记录、任务、扫描进度
```

## 2. 书签数据流

1. 新标签页启动后通过 `bookmarkService` 读取 `chrome.bookmarks.getTree()`。
2. `bookmarkAdapter` 把原生节点转换为展示模型。
3. 主页展示书签栏中的文件夹/书签，以及其他书签。
4. Chrome 书签事件触发刷新合并，更新页面。
5. 新增、编辑、删除、重命名、移动直接调用 Chrome Bookmarks API。
6. 写操作后通过短窗口刷新合并读取一次完整树，避免主动刷新和事件刷新重复读取。

书签写入不接受 `javascript:`、`data:` 等非 HTTP/HTTPS 协议。系统根节点不可重命名、
移动或删除。删除没有回收站。

## 3. 页面与交互

- 主页：搜索框、搜索引擎切换、书签栏分组、其他书签、空状态、错误提示。
- 书签卡片：favicon、标题、右键菜单、更多菜单。
- 管理：新增/编辑弹窗、文件夹选择器、移动弹窗、删除确认、拖拽排序。
- 健康：状态点、详情浮层、健康面板、筛选、进度和取消。
- 搜索偏好只保存 `bookmarkHome.searchEngineId`，使用 `chrome.storage.sync`。
- favicon 使用 Chrome 本地 `_favicon` 接口，不请求第三方服务。

当前没有独立设置中心，也没有深色主题、密度或布局设置。

## 4. 网站健康检查

### 状态

| 状态 | 含义 |
|---|---|
| `healthy` | 2xx，且未跳转 |
| `redirected` | 3xx，或跟随跳转后最终 2xx |
| `not_found` | 404 |
| `gone` | 410 |
| `restricted` | 401/403/429 |
| `server_error` | 5xx |
| `unknown` | 网络/TLS/DNS/超时或无法归类的状态 |
| `pending` | 待检测 |
| `checking` | 检测中 |
| `unsupported` | 非 HTTP/HTTPS |
| `private` | 字面主机名为内网/本机，跳过 |

### 请求

- 仅 HTTP/HTTPS。
- 优先 `HEAD`；服务器返回 405/501 时使用带 `Range: bytes=0-0` 的 `GET`。
- `credentials: "omit"`，不发送 Cookie。
- `cache: "no-store"`、`referrerPolicy: "no-referrer"`。
- 单次超时 10 秒，使用 `AbortController`。
- 网络/5xx/超时最多重试一次，间隔约 3 秒。
- 只读取状态码和最终 URL，取消响应体，不读取页面正文。
- 非 HTTP/HTTPS、localhost、回环、私网、链路本地和常见内网后缀不检测。

### 缓存与队列

- 缓存键是规范化完整 URL，保留路径和查询参数，去 fragment。
- 健康状态、检测时间、下次检测时间、最终 URL、任务和扫描进度写入
  `chrome.storage.local` 的 `bookmarkHome.health.state`。
- 全局并发 3，同域并发 1，每批最多 10 个任务。
- 当前批次结束后若仍有到期任务，1 秒后自动续跑；不无限轮询。
- 新书签延迟 5 秒入队；删除/修改 URL 后清理孤儿任务。
- 导入书签后重新读取完整树，批量加入 HTTP/HTTPS URL，跳过重复、内网和非 HTTP。
- 无引用的健康记录最多保留 30 天。
- 新标签页打开只读取快照，不主动入队，也不发起网络检测。

### Service Worker

- 使用 `chrome.alarms`，不使用 `setInterval`。
- tick 每分钟执行健康检查；maintenance 每 6 小时清理；书签变化后注册一次性 cleanup。
- 任务和扫描状态持久化；Service Worker 重启后把 `checking` 恢复为 `pending`。
- 连续中断达到上限时转为 `unknown`，避免无限重复。
- 已验证 CDP `ServiceWorker.stopWorker` 后的恢复；完整 1 分钟 alarm 周期仍需真实观察。

## 5. 权限设计

| 权限 | 用途 |
|---|---|
| `bookmarks` | 读取和管理原生书签 |
| `storage` | 保存搜索偏好和本地健康缓存 |
| `favicon` | 读取 Chrome 本地图标 |
| `alarms` | 安排检测和清理任务 |
| `host_permissions: <all_urls>` | 对书签中的任意 HTTP/HTTPS URL 发起健康检查 |

没有内容脚本，没有 `tabs`、`history`、`cookies`、`webRequest`、`scripting` 权限。
`<all_urls>` 是健康检查所需的网络权限，不代表读取所有网页内容。

详细说明：

- [隐私政策](../PRIVACY.md)
- [权限用途](../store/PERMISSIONS.md)
- [安全审查](SECURITY_REVIEW.md)

## 6. 安全边界

- 书签输入只接受 HTTP/HTTPS，拒绝危险协议。
- 健康检查不读取页面正文、Cookie 或浏览历史，不携带登录状态。
- 内网保护只检查 URL 字面主机名，不做 DNS 解析。
- 公网域名解析到私网 IP，或公网页面重定向到内网地址，不在字面主机名保护范围内。
- 健康检查请求由用户主动触发或本地 alarm 调度，不在后台扫描任意网页。

## 7. 构建与产物

- `pnpm build`：生成 `.output/chrome-mv3`。
- `pnpm zip`：生成 `.output/bookmark-home-<version>-chrome.zip`。
- `pnpm verify:extension`：检查 manifest、版本、权限、入口、图标、ZIP 根目录、
  禁止文件、ZIP SHA-256，并生成 `.output/build-report.json`。
- 版本唯一来源是 `package.json`，WXT 构建时写入 manifest。
- ZIP 根目录直接包含 `manifest.json`、`background.js`、`newtab.html` 和资源目录。
