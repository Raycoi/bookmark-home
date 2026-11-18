# 测试说明

## 1. 快速命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm zip
pnpm verify:extension
```

`pnpm check` 依次执行 lint、typecheck、单元测试、构建、ZIP 和产物校验。

## 2. 单元测试

- 19 个测试文件，235 项测试。
- 工具：Vitest。
- 覆盖：
  - 书签树转换、根节点、嵌套顺序、其他/移动设备书签。
  - 书签和文件夹 CRUD、移动、系统节点保护。
  - 读取失败、旧数据保留和 `stale` 状态。
  - 文件夹树、循环校验、拖拽 index。
  - 搜索、favicon、URL 规范化和内网识别。
  - 健康状态映射、HTTP 检测、重试、超时、并发和缓存。
  - 自动续跑、导入入队、刷新合并。
  - 健康快照竞态、后台初始化失败恢复。

## 3. 真实 Chrome 测试

本地真实 Chrome 套件共 **87 项**：

| 套件 | 数量 | 重点 |
|---|---:|---|
| 健康检查核心 | 18 | 状态、HEAD→GET、重试、进度、详情、取消 |
| 健康保护 | 6 | 429、内网、筛选 |
| Service Worker 恢复 | 8 | `stopWorker`、`checking → pending`、alarm 持久性 |
| 书签 CRUD/菜单 | 29 | 新增、编辑、删除、移动、文件夹、错误 |
| 拖拽/重载 | 18 | 同级排序、跨文件夹、投放、重载 |
| 输入/焦点 | 2 | 端口地址、Esc 后焦点 |
| 自动续跑 | 6 | 21 个任务按 10+10+1 完成 |

运行方式和前置条件见 [`scripts/browser/README.md`](../scripts/browser/README.md)。

这些测试不会在普通 GitHub Actions runner 中默认执行：

- `Extensions.loadUnpacked`、`ServiceWorker.stopWorker` 依赖真实 Chrome；
- 需要 `example.test` host resolver 和本机 HTTP 服务；
- Chrome 原生文件选择器无法由 CDP 自动操作。

## 4. CI

CI 执行 lint、typecheck、235 项单元测试、build、zip 和产物校验，并上传 ZIP 与
`build-report.json`。

CI 不替代真实 Chrome 测试。任何涉及书签写入、拖拽、健康检查、alarm 或 Service
Worker 的修改，都应在本地补跑相关真实 Chrome 套件。

## 5. 尚未覆盖 / 人工验证

- Chrome 原生“导入书签”文件选择器导入。
- 完整 1 分钟 alarm 周期下的长任务行为。
- 移动设备/额外区域书签在对应真实同步配置中的定位分支。
- Chrome Web Store 审核环境。

真实 Chrome 测试结果不能由单元测试结果代替。
