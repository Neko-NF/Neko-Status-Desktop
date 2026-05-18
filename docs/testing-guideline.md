# 测试规范

本文说明 Neko Status Desktop 的测试层级、命令、覆盖范围和 PR 验收标准。

## 常用命令

```bash
npm test
npm run test:watch
npm run test:coverage
npm run test:smoke
npm run verify
npm run build:zip
```

含义：

- `npm test`：运行 Node 内置 test runner，覆盖 `tests/unit/*.test.js`。
- `npm run test:watch`：单元测试 watch 模式。
- `npm run test:coverage`：实验性覆盖率输出。
- `npm run test:smoke`：启动最小 Electron 隐藏窗口，验证 preload 与 IPC bridge。
- `npm run verify`：静态结构检查、语法检查、编码污染扫描，再运行单元测试。
- `npm run build:zip`：Windows ZIP 打包检查。

## 测试分层

```text
tests/
  unit/    纯 JS、主进程 helper、IPC 注册、renderer VM 测试
  smoke/   Electron 最小启动与 preload/IPC 验证
```

当前项目优先使用 Node 内置测试能力，避免为了少量测试引入大型框架。

## 当前覆盖范围

单元测试覆盖：

- IPC channel / event 唯一性。
- IPC 统一响应 helper。
- 主进程 IPC 注册与 handler 行为。
- payload schema。
- 配置默认值、合并和旧配置修复。
- 启动更新 gate。
- 后台更新检查。
- renderer services 方法委托。
- renderer 页面 VM 测试：配置页、更新页、截图页、设备状态页、认证页、主题模块、开发者控制台。

Smoke 覆盖：

- Electron 能启动隐藏窗口。
- `src/preload/index.js` 能加载。
- `window.nekoIPC` 存在。
- IPC 常量能暴露到 renderer。
- 基础 invoke round-trip 正常。

## Verify 检查内容

`scripts/verify.js` 当前检查：

- 必要文件结构。
- renderer split module 语法。
- HTML 关键 ID。
- CSS 关键类名。
- PowerShell 编码处理。
- 文本文件编码污染。
- 配置默认值。
- 更新系统完整性。
- 活动流结构。
- IPC 通道一致性。

新增 renderer service / page / component 后，必须同步 `scripts/verify.js` 的文件结构和语法检查列表。

## Electron smoke test

运行：

```bash
npm run test:smoke
```

该测试需要真实桌面权限。受限 shell 中如果出现 Chromium/GPU 启动错误，不能直接判定业务失败，应在真实 GUI 环境重跑。

测试失败时优先排查：

- `src/preload/index.js` 是否语法错误。
- `BrowserWindow.webPreferences.preload` 是否正确。
- `contextIsolation` / `sandbox` 是否影响 preload。
- `src/shared/ipc-contracts.js` channel 是否与测试桩一致。
- 是否出现 `No handler registered`。

## Dev 版启动验收

涉及 preload、IPC、主窗口、renderer 初始化时，PR 级验收建议执行：

```bash
npm run verify
npm run test:smoke
npm run dev
```

dev 日志必须确认：

- 没有 `preload bridge missing`。
- 没有 `process is not defined`。
- 没有 `No handler registered`。
- 没有 `IPC method missing`。
- 没有 renderer `Uncaught ReferenceError`。
- 主进程初始元数据同步成功。

Electron 开发态 CSP warning 可以接受，但不应扩大到生产构建配置。

## 条件 UI 测试

只在特定状态出现的 UI 必须提供可复现入口，例如：

```bash
npm run dev:startup-update:checking
npm run dev:startup-update:available
npm run dev:startup-update:download
npm run dev:startup-update:installing
npm run dev:startup-update:failed
npm run dev:startup-update:offline
npm run dev:startup-update:up-to-date
```

条件 UI 包括：

- 启动前更新窗口。
- 更新下载进度。
- 更新失败放行。
- 截图权限失败。
- 推流连接失败。
- 后台服务不可用。
- 登录或服务器配置缺失状态。

新增条件 UI 时，至少补一个单测、dev scenario 或清晰手工验收步骤。

## 新增测试原则

优先顺序：

1. `shared` 纯函数和 schema。
2. `main` 中可脱离 Electron 的 helper。
3. IPC handler 注册和返回结构。
4. renderer service VM 测试。
5. renderer page DOM mock 测试。
6. Electron smoke 或 dev scenario。

不要为了测试强行改业务逻辑。如果 Electron API 难以直接测试，使用 mock 或拆出纯 helper。

## PR 验收清单

普通 PR：

- `npm run verify`
- 与改动相关的单元测试

涉及 preload / IPC / renderer 初始化：

- `npm run test:smoke`
- dev 日志检查

涉及打包、更新、发布：

- `npm run build:zip`
- release workflow 相关检查

涉及 UI：

- 至少一条手工验收说明或截图记录
- 移动/缩放/主题切换不破坏布局

## 常见问题判断

- Windows 终端显示乱码，但 `npm run verify` 编码扫描通过：优先判断为终端编码显示问题。
- `GPU process isn't usable`：优先判断 Electron/Chromium GPU 环境问题，使用真实 GUI 权限重跑。
- `preload bridge missing`：优先检查 preload 路径和 `webPreferences`。
- `No handler registered`：优先检查 `IPC_CHANNELS`、preload 暴露和 `src/main/ipc/*.ipc.js` 是否同步。
- renderer `ReferenceError`：优先跑 dev 版查看真实加载顺序和全局依赖。
