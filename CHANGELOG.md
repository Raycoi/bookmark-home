# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 和
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 的基本结构。

## [0.1.0] - 2026-11-18

首个可安装的 Chrome 扩展版本。

### Added

- 以 Chrome 原生书签为唯一数据源的新标签页。
- 书签栏、其他书签、嵌套文件夹和常用网站展示。
- Google、Bing、百度、DuckDuckGo 搜索切换，偏好保存到 `chrome.storage.sync`。
- Chrome 本地 `_favicon` 图标，不请求第三方 favicon 服务。
- 新增、编辑、删除、重命名、移动书签和文件夹。
- 菜单、确认、移动选择器、拖拽排序和文件夹投放。
- 网站健康检查：正常、跳转、404、410、访问受限、服务器异常、无法确认、待检测、检测中、无法检测、内网地址。
- HEAD → GET 回退、超时、重试、全局限流、同域限流和批量扫描进度。
- 健康检查缓存、扫描状态和任务持久化到 `chrome.storage.local`。
- Service Worker 中断后的 `checking → pending` 恢复。
- 超过 10 个任务时自动续跑，每批最多 10 个，批间 1 秒。
- 导入书签后批量加入健康检查队列，跳过重复、内网和非 HTTP/HTTPS URL。
- 写操作后的刷新合并，减少重复完整书签树读取。
- 真实 Chrome 自动化脚本、ESLint、TypeScript 检查、单元测试和基础 CI。
- GitHub Actions CI：lint、typecheck、unit test、build、zip、产物校验和 artifact。
- GitHub Release 工作流、完整版本/CHANGELOG 校验和发布检查清单。
- Chrome Web Store 文案、权限说明、隐私政策、真实截图和宣传图。

### Changed

- 省略协议的带端口地址（如 `example.com:8080`）按主机名补全为 `https://example.com:8080/`。
- 文件夹菜单、拖拽和投放共用同一套交互委托。
- 健康快照只接受最新请求结果，避免旧响应覆盖新状态。

### Fixed

- 修复健康面板并发加载时旧快照覆盖新快照的问题。
- 修复后台初始化失败后 Promise 永久 rejected、无法重试的问题。
- 修复对话框、菜单和健康详情关闭后焦点丢失的问题。
- 修复 favicon 查询地址缓存无上限的问题。
- 修复新增/编辑书签时 URL 被重复解析的问题。

### Removed

- 删除重复的 `moveNode` 书签 API，只保留带循环保护的 `moveBookmark` / `moveFolder`。
- 删除生产代码中只被测试使用的健康缓存 helper 和原生节点分类死代码。

### Security

- 书签新增和编辑只接受 HTTP/HTTPS，拒绝 `javascript:`、`data:` 等危险协议。
- 健康检查使用 `credentials: "omit"`、`cache: "no-store"`、`referrerPolicy: "no-referrer"`，不携带 Cookie。
- 不读取页面正文、Cookie、浏览历史，不注入内容脚本。
- 内网/本机地址在字面主机名层跳过检测。
- 不向第三方上传书签，不建立独立书签数据库，不收集遥测。

### Permissions

- `bookmarks`：读取和管理 Chrome 原生书签。
- `storage`：保存搜索引擎偏好和本地健康检查缓存。
- `favicon`：读取 Chrome 本地缓存的网站图标。
- `alarms`：安排健康检查任务。
- `host_permissions: <all_urls>`：在扩展后台对用户书签中的 HTTP/HTTPS URL 发起健康检查请求。

### Known Issues

- Chrome 原生“导入书签”文件选择器无法由 CDP 自动化，真实导入事件需要人工验证。
- 已验证 Service Worker 终止/恢复和 alarm 持久性，但尚未等待一次完整的 1 分钟真实 alarm 周期。
- 移动设备/额外区域书签的定位分支只能在具备对应书签节点的真实配置中点击验证。
- 内网保护基于 URL 字面主机名，不做 DNS 解析；公网域名解析或重定向到内网地址不在本层防护范围内。

### Compatibility

- Chrome 109+，Manifest V3。
- 当前真实测试基准：Chrome 157.0.8103.79。
- 仅支持桌面 Chrome 新标签页；不提供 Firefox、Edge、Safari 版本。
