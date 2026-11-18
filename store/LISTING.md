# Chrome Web Store 上架资料

本文件是 Bookmark Home 的商店文案和素材清单，不代表已经提交审核或上架。

## 1. 基本信息

| 字段 | 建议值 |
|---|---|
| 名称 | `Bookmark Home` |
| 中文名称 | `Bookmark Home · 书签新标签页` |
| 简短说明 | 把 Chrome 原生书签变成干净的新标签页，支持搜索、管理和网站健康检查。 |
| 分类 | 生产力工具（Productivity） |
| 语言 | 简体中文 |
| 官网/主页 | `https://github.com/Raycoi/bookmark-home` |
| 支持地址 | `https://github.com/Raycoi/bookmark-home/issues` |
| 隐私政策 | `https://github.com/Raycoi/bookmark-home/blob/main/PRIVACY.md` |

简短说明为商店短描述候选，正式提交时需要再次核对 Chrome Web Store 当前字符上限。

## 2. 详细说明

Bookmark Home 把 Chrome 原生书签整理成一个干净、快速的新标签页。

### 主要功能

- **原生书签展示**：直接读取 Chrome 书签栏、其他书签和嵌套文件夹，不建立第二套
  书签数据库。
- **快速搜索**：在主页直接使用 Google、Bing、百度或 DuckDuckGo 搜索，记住上次
  选择的搜索引擎。
- **书签管理**：新增、编辑、删除、重命名、移动书签和文件夹，支持菜单、右键菜单
  和拖拽排序。
- **网站健康检查**：可选地对书签中的 HTTP/HTTPS 地址做轻量 HEAD/GET 检测，显示
  正常、跳转、404、410、访问受限、服务器异常和无法确认等状态。
- **本地优先**：健康检查缓存只保存到 `chrome.storage.local`，搜索引擎偏好只保存到
  `chrome.storage.sync`，不上传书签到开发者服务器。
- **轻量界面**：不改变 Chrome 原有书签数据和 Chrome 自己的跨设备同步。

### 设计原则

- Chrome 原生书签是唯一书签数据源。
- 不使用第三方 favicon 服务，使用 Chrome 本地 `_favicon`。
- 不注入网页脚本，不读取网页正文，不读取浏览历史。
- 不收集使用统计，不包含广告、遥测或崩溃上报。

### 适合谁

希望新标签页保持简洁，同时仍然使用 Chrome 原生书签和 Chrome 自身同步的用户。

## 3. 权限用途说明

完整的商店审核说明见 [PERMISSIONS.md](PERMISSIONS.md)。

摘要：

- `bookmarks`：读取和管理 Chrome 原生书签。
- `storage`：保存搜索引擎偏好和本地健康检查缓存。
- `favicon`：读取 Chrome 本地缓存的网站图标。
- `alarms`：安排健康检查和清理任务。
- `host_permissions: <all_urls>`：在扩展后台对书签中的任意 HTTP/HTTPS URL 发起
  健康检查请求。

## 4. 截图

真实产品截图位于 [screenshots/](screenshots/)，均为 1280 × 800 PNG，来自真实运行中
的扩展，没有 AI 绘制界面。

| 文件 | 画面 | 建议说明 |
|---|---|---|
| `01-home-search.png` | 新标签页主页、搜索和常用网站 | “干净的新标签页，原生书签和搜索” |
| `02-bookmarks.png` | 分组书签和文件夹 | “书签栏、文件夹和常用网站” |
| `03-health.png` | 网站健康面板 | “可选的本地网站健康检查” |

当前产品没有独立设置中心；搜索引擎切换在主页搜索框右侧完成。截图清单不虚构设置页。
截图中的书签和健康状态是本地演示数据，界面本身来自真实运行中的扩展。

## 5. 宣传图

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `promo/small-440x280.png` | 440 × 280 | 商店小型宣传图 |
| `promo/marquee-1400x560.png` | 1400 × 560 | 商店顶部 Marquee（如商店账号支持） |

设计说明：

- 背景使用产品主页的暖灰 `#f6f5f2` 和白色卡片。
- 主色使用产品强调蓝 `#365fc7`。
- 图形只使用实际扩展图标和文字，不拼接虚假界面截图。
- 小图强调“原生书签、干净的新标签页”；Marquee 强调“原生书签 · 快速搜索 ·
  网站健康检查”。
- 所有文案都是产品实际能力，不包含“最好”“第一”等无法验证的表述。

## 6. 隐私与数据使用

提交商店时需要按实际行为填写数据使用表单。本项目的事实依据：

- 开发者不收集用户身份、浏览历史、网页正文、Cookie 或使用统计。
- 书签数据只通过 `chrome.bookmarks` 读取和写入，不上传到开发者服务器。
- 健康检查请求直接发往书签 URL 对应的网站；目标网站可能看到请求 IP 和 URL。
- 健康检查缓存只保存在本机 `chrome.storage.local`。
- 搜索引擎偏好只保存在 `chrome.storage.sync`。
- 没有远程脚本、第三方统计 SDK 或广告 SDK。

完整说明见 [PRIVACY.md](../PRIVACY.md)。

## 7. 提交前待确认

- 仓库已创建为 Public：<https://github.com/Raycoi/bookmark-home>。
- GitHub Issues、隐私政策和支持 URL 已可访问。
- 商店开发者账号是否具备发布权限。
- 是否使用商店的 Marquee 位置。
- 正式提交必须由维护者在 Chrome Web Store 后台完成；本仓库没有自动提交商店。
