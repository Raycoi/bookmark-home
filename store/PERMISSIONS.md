# Bookmark Home 权限用途说明

本文件用于 Chrome Web Store 审核和隐私说明。所有描述以当前代码为准。

## permissions

### `bookmarks`

用途：读取用户 Chrome 原生书签树，并在用户操作时新增、修改、删除、重命名和移动
书签/文件夹。

- 书签栏和其他书签显示在主页。
- 嵌套文件夹用于分组、移动和拖拽排序。
- 不使用独立书签数据库，不把书签树复制到 `chrome.storage`。

### `storage`

用途：保存少量用户设置和本地健康检查缓存。

- `chrome.storage.sync`：只保存 `bookmarkHome.searchEngineId`，即搜索引擎偏好。
- `chrome.storage.local`：保存 `bookmarkHome.health.state`，即健康检查记录、任务和
  扫描进度。

不保存浏览历史、网页正文、Cookie 或用户身份。

### `favicon`

用途：通过 Chrome 的 `_favicon` 接口显示书签站点图标。

- 不使用第三方 favicon 服务。
- 图标由 Chrome 本地缓存管理。

### `alarms`

用途：安排网站健康检查、过期记录维护和书签删除后的缓存清理。

- 每分钟的 tick 用于执行健康检查任务。
- 每 6 小时的 maintenance 用于清理过期记录。
- 书签变化后注册一次性 cleanup alarm，作为 Service Worker 休眠的兜底。

## host_permissions

### `<all_urls>`

用途：健康检查需要对用户书签中的任意 HTTP/HTTPS URL 发起请求。书签可能指向任意
公网站点，因此扩展在后台声明广泛主机权限。

实际行为：

- 只发起 `HEAD`，在服务器返回 405/501 时回退到带 `Range: bytes=0-0` 的 `GET`。
- `credentials: "omit"`，不发送 Cookie。
- `cache: "no-store"`、`referrerPolicy: "no-referrer"`。
- 不读取页面正文，只读取响应状态和最终 URL。
- 不注入内容脚本，不读取网页 DOM。
- 不读取浏览历史。
- 不把书签 URL 上传到开发者或第三方健康检查服务。
- 字面主机名为内网/本机的地址不进入检测。

`<all_urls>` 是健康检查能力所需，不代表扩展读取所有网页内容。扩展没有声明
`content_scripts`，没有内容脚本，也没有网页消息通道。

## 未使用的权限

当前 manifest 没有声明：

- `tabs`
- `history`
- `cookies`
- `webRequest`
- `scripting`
- `downloads`
- `management`
- `identity`
- `notifications`
- `offscreen`

不为了商店审核而删除健康检查所需的权限，也不添加与功能无关的权限。

## 权限变更规则

任何权限变化必须：

1. 在 `wxt.config.ts` 和实际代码中同时确认；
2. 更新本文件、`PRIVACY.md`、`CHANGELOG.md` 和 `README.md`；
3. 在正式发布前重新执行构建产物检查和真实 Chrome 回归；
4. 在商店审核说明中解释新增权限的真实用途。
