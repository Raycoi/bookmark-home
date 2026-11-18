# Bookmark Home 发布检查清单

本清单适用于 GitHub Release 和 Chrome Web Store 两个独立流程。完成 GitHub Release
不代表已经上架 Chrome Web Store。

## 1. 版本与仓库

- [ ] 当前分支是 `main`，工作区 clean。
- [ ] 最新提交已通过 CI。
- [ ] `package.json` 版本为预期 SemVer，例如 `0.1.0`。
- [ ] `CHANGELOG.md` 存在对应版本记录（例如 `## [0.1.0] - 2026-11-18`）。
- [ ] 正式 Tag 名与版本一致：`v0.1.0`。
- [ ] Tag 未存在，或已确认不覆盖已有正式 Tag。
- [ ] Tag 指向 `main` 可达的提交。
- [ ] 首次推送/创建远端仓库已得到用户确认。
- [ ] 没有未提交的密钥、临时文件、个人路径或构建产物。

## 2. 代码与测试

- [ ] `pnpm lint` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 全部通过（当前 235 项）。
- [ ] `pnpm build` 通过。
- [ ] `pnpm zip` 通过。
- [ ] `pnpm verify:extension` 通过。
- [ ] 真实 Chrome 核心回归通过（当前 87 项）。
- [ ] Service Worker 终止/恢复和 alarm 持久性通过。
- [ ] 超过 10 个任务自动续跑通过。
- [ ] 原生“导入书签”人工验证完成（CDP 无法自动操作原生文件选择器）。
- [ ] 移动设备/额外区域定位分支在对应真实配置中验证，或明确记录未验证。
- [ ] 没有 P0 问题；P1 已知问题已记录。

## 3. 构建产物

- [ ] ZIP 根目录直接包含 `manifest.json`、`background.js`、`newtab.html`。
- [ ] 没有外层项目文件夹。
- [ ] 没有 `node_modules`、`.git`、`tests`、`scripts`、`docs`、`.github`、
      source map、日志、`.e2e-state.json`。
- [ ] Manifest V3。
- [ ] 权限只有 `bookmarks`、`storage`、`favicon`、`alarms`。
- [ ] `host_permissions` 只有 `<all_urls>`。
- [ ] 图标、`icon/`、`assets/`、`chunks/` 存在。
- [ ] `manifest.version` 与 `package.json` 一致。
- [ ] 已记录 ZIP 大小和 SHA-256。
- [ ] ZIP 已在干净 Chrome 配置中实际加载并打开新标签页。

## 4. GitHub Release

- [ ] `main` 上 CI 最新运行成功。
- [ ] Tag 已推送到远端，或确认手动运行 Release workflow。
- [ ] Release workflow 完成 lint/typecheck/test/build/zip/verify。
- [ ] `scripts/release-check.mjs` 通过 Tag/版本/CHANGELOG 校验。
- [ ] 同名 Release 不存在；不得覆盖。
- [ ] Release 上传正式 ZIP。
- [ ] Release Notes 来自整理的 CHANGELOG，不是自动堆叠的提交摘要。
- [ ] Release Notes 包含 SHA-256、安装说明和已知问题。
- [ ] 下载 Release ZIP 后重新核对 SHA-256。

## 5. Chrome Web Store 资料

- [ ] 名称、简短说明、详细说明已按商店字符限制复核。
- [ ] 分类为生产力工具。
- [ ] 截图来自真实产品，尺寸 1280×800 或商店当前允许的规格。
- [ ] 截图不包含个人信息、开发路径、密钥或虚假界面。
- [ ] 小型宣传图和 Marquee（如使用）尺寸符合当前商店要求。
- [ ] `PRIVACY.md` 已发布为可公开访问的 URL。
- [ ] `store/PERMISSIONS.md` 与实际 manifest 一致。
- [ ] 数据使用表单与隐私政策一致。
- [ ] 支持 URL、隐私政策 URL、主页 URL 已可访问。
- [ ] 开发者账号具备发布权限。
- [ ] 真实联系方式已确认，不虚构公司、邮箱或地址。

## 6. Chrome Web Store 提交

- [ ] 由维护者登录 Chrome Web Store 开发者后台。
- [ ] 上传 ZIP 或商店要求的包格式。
- [ ] 填写权限用途说明。
- [ ] 提交审核。
- [ ] 记录审核状态和反馈。
- [ ] 审核通过后确认正式上架；审核通过前不得声称已上架。

## 7. 发布后

- [ ] 从商店安装/从 Release ZIP 加载，打开新标签页。
- [ ] 检查书签读取、搜索、CRUD、健康检查和“无数据”状态。
- [ ] 检查扩展更新后的权限提示。
- [ ] 记录 Release URL、商店 URL、版本、SHA-256 和发布日期。
- [ ] 如果发现严重问题，暂停继续发布并准备补丁版本；不要覆盖正式 Tag。

## 8. 当前阻塞/待确认

- GitHub 公开仓库已创建并推送 `main`。
- 远端 CI 已成功运行（run 44309583585）。
- 正式 Tag `v0.1.0` 尚未创建。
- GitHub Release 尚未创建。
- Chrome Web Store 尚未提交审核。
- 原生导入书签需要人工验证。
- 需要用户确认正式 Tag/Release 和商店提交。
