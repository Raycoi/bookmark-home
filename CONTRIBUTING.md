# 贡献指南

Bookmark Home 使用 WXT + Vue 3 + TypeScript，目标平台只有 Chrome（Manifest V3）。
Chrome 原生书签是唯一书签数据源，不建立独立书签数据库。

## 1. 环境

- Node.js `24.22.1`（CI 使用同一版本）
- pnpm `10.34.5`
- Chrome 157 或更新版本用于真实 UI 回归
- Windows、macOS 或 Linux 均可开发；真实 Chrome 脚本当前以 Windows 路径示例

## 2. 安装

```bash
pnpm install --frozen-lockfile
```

首次安装会执行 WXT 的 `postinstall` 生成类型。

## 3. 本地开发

```bash
pnpm dev
```

在 `chrome://extensions` 开启开发者模式，加载 `.output/chrome-mv3`（或 WXT 开发
模式提示的目录）。不要提交 `.output/`、`.wxt/`、`.e2e-state.json` 或本地配置。

## 4. 检查命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm zip
pnpm verify:extension
```

一键执行全部检查：

```bash
pnpm check
```

`pnpm check` 会执行 lint、typecheck、unit test、生产构建、ZIP 和产物校验。

## 5. 真实 Chrome 测试

脚本位于 [`scripts/browser/`](scripts/browser/README.md)，需要真实 Chrome 和独立
临时用户目录：

```bash
node scripts/browser/load-extension.mjs
node scripts/browser/bookmark-crud.mjs
node scripts/browser/bookmark-drag.mjs
node scripts/browser/bookmark-port-focus.mjs
node scripts/browser/health-core.mjs
node scripts/browser/health-protection.mjs
node scripts/browser/health-sw-recovery.mjs
node scripts/browser/health-auto-continue.mjs
```

真实 Chrome 测试不会在普通 GitHub Actions runner 中默认执行：

- 扩展 Service Worker 的 CDP 终止/恢复需要真实 Chrome 环境；
- 原生文件选择器导入需要人工操作；
- 测试依赖本机 `example.test` 解析和临时 HTTP 服务。

如果修改了书签数据层、健康检查、alarm 或 Service Worker，请至少运行相关真实
Chrome 脚本，并在 PR 中说明结果。

## 6. 代码规范

- 使用 TypeScript strict，不引入未使用变量。
- 不新增第三方 UI 库、状态库或遥测 SDK。
- 不新增与功能无关的权限。
- 不把书签树写入 `chrome.storage`。
- 不向第三方上传书签 URL。
- 不在生产代码里写死密钥、Token、个人路径或固定扩展 ID。
- 新增用户可见行为时更新 `CHANGELOG.md`。
- 修改权限、网络行为或隐私行为时同时更新 `PRIVACY.md`、`store/PERMISSIONS.md`
  和 `docs/SECURITY_REVIEW.md`。

## 7. Pull Request

1. 从 `main` 创建短期分支。
2. 提交前运行 `pnpm check`。
3. PR 描述写清楚行为变化、测试结果和权限变化。
4. 所有 CI 检查必须通过。
5. 不强制推送已共享的历史，不覆盖正式 Tag。
6. 不在 PR 中提交生成物、密钥、日志和本地 Chrome 配置。

## 8. 版本与发布

- 版本号只在 `package.json` 维护；WXT 构建时生成 manifest 版本。
- 正式 Tag 使用 `vMAJOR.MINOR.PATCH`，必须与 `package.json` 一致。
- 正式发布前必须通过 CI、产物校验和 `RELEASE_CHECKLIST.md`。
- 不手工覆盖已有 Release 或正式 Tag。

## 9. 许可证

本项目使用 [MIT License](LICENSE)。提交贡献即表示你同意以同一许可证分发你的贡献。

## 10. 安全问题

不要在公开 Issue 中提交密钥、真实书签内容或可复现的敏感 URL。请先通过维护者的
GitHub 联系方式私下说明。