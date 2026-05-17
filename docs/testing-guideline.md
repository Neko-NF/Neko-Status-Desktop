# 测试规范

## 当前测试命令

```bash
npm test
npm run test:watch
npm run test:coverage
npm run verify
```

## 当前覆盖范围

当前测试是最小工程化基线，重点覆盖：

- shared IPC 契约
- shared schema 校验
- 配置默认值与合并逻辑
- 文本文件编码污染扫描

## 当前策略

- 使用 Node 内置测试运行器
- 优先覆盖纯函数、共享模块、配置规则
- 避免一开始就把 Electron 原生能力塞进测试
- `npm run verify` 会扫描常见 UTF-8/GBK 乱码特征；如果 Windows 终端显示乱码，但该检查通过，优先怀疑终端输出编码而不是文件已损坏

## 新增测试的建议

优先顺序：

1. `shared` 纯函数
2. `main` 层可脱离 Electron 的 helper
3. `preload` 方法映射
4. renderer 纯状态逻辑

## 提交前要求

- `npm run verify` 必须通过
- 涉及新 schema、配置、IPC 契约时，必须补对应测试
- 新增或批量修改中文文档、UI 文案、PowerShell 输出解析逻辑后，必须确认编码污染扫描仍通过

## 前后端桥接回归检查

详见 [前后端桥接故障复盘与防错清单](./frontend-backend-integration-guardrails.md)。

涉及 Electron preload、IPC、页面按钮或后端 handler 的改动，提交前至少执行：

```bash
node --check src/preload/index.js
node --check src/renderer/js/app-ipc.js
npm run lint
node --test --test-concurrency=1 "tests/unit/*.test.js"
```

开发版人工检查必须确认：

- `npm run dev` 通过真实 GUI 启动方式验证，不要把受限 shell / 沙箱里启动 Electron 的结果当作唯一结论。
- 日志没有 `preload bridge missing`。
- 日志没有 `process is not defined`。
- 日志没有持续性的 `GPU process isn't usable`；如果出现，确认启动脚本是否已触发软件渲染兜底并继续打开窗口。
- 点击页面按钮时，不只是 UI 状态变化，还能看到后端状态或持久化结果变化。
- 新增 IPC 的返回结构有单元测试覆盖。

## Dev 启动与临时 exe 对照

当开发版启动失败但怀疑不是业务代码问题时，按以下顺序复核：

1. 先运行 `npm run verify`，确认静态校验和单元测试通过。
2. 运行 `npm run build`，启动 `dist/win-unpacked/NekoStatus.exe` 做临时正式态对照。
3. 如果临时 exe 可以打开，而受限 shell 中的 `npm run dev` 报 `GPU process exited unexpectedly` 或 `GPU process isn't usable. Goodbye.`，优先判断为 dev 启动环境 / Electron dev binary / GPU 初始化问题。
4. 使用真实 GUI 权限重新启动 `npm run dev`。在 Codex 或类似工具中，GUI 启动应走提升权限，不要用普通沙箱命令直接下结论。
5. 如果 GUI 权限下 dev 仍失败，再检查 `scripts/start-electron.js` 的 GPU fallback、`src/main/main.js` 早期 `app.disableHardwareAcceleration()` 分支，以及最近是否新增透明窗口、无边框窗口或启动前更新窗口逻辑。

判断依据：

- GPU fatal：优先看启动环境和 Electron/Chromium GPU 参数。
- `preload bridge missing`：优先看 `webPreferences.preload`、`contextIsolation`、`sandbox`。
- `process is not defined`：优先看 renderer 是否直接访问 Node 全局。
- IPC handler missing：优先看 `src/shared/ipc-contracts.js`、`src/preload/index.js`、`src/main/ipc/*.ipc.js` 是否同步。

## 条件型 UIUX / 前后端状态测试

凡是只在特定状态下出现的界面，都必须提供可重复触发的开发版入口，不能只依赖真实网络、真实 GitHub Release、真实权限失败或真实安装器。典型场景包括：启动前更新窗口、下载进度、更新失败放行、截图权限失败、推流连接失败、后台服务不可用。

启动前更新 UI 的开发版场景命令：

```bash
npm run dev:startup-update:checking
npm run dev:startup-update:available
npm run dev:startup-update:download
npm run dev:startup-update:installing
npm run dev:startup-update:failed
npm run dev:startup-update:offline
npm run dev:startup-update:up-to-date
```

也可以直接传参：

```bash
npm run dev -- --dev-startup-update=download
npm run dev -- --dev-startup-update=installing
npm run dev -- --dev-startup-update=up-to-date
```

约束：

- 开发场景只能在 `app.isPackaged === false` 时生效，生产包不得读取这些场景来改变真实更新逻辑。
- 场景入口要覆盖前端 UI、preload 事件、主进程状态分发三层，不允许只做静态页面截图。
- 新增条件型 UI 时，至少补一个单元测试或开发场景命令，并在相关文档写明如何触发。
- 失败态必须验证“放行路径”：例如启动更新失败或离线时，必须能继续打开主窗口。
# 2026-05 Renderer service 检查补充

拆分 renderer service 或 page 后，提交前至少补充以下语法检查：

```bash
node --check src/renderer/js/services/ipc-client.js
node --check src/renderer/js/services/stream-client.js
node --check src/renderer/js/pages/stream.page.js
node --check src/renderer/js/pages/settings.page.js
```

service 层测试优先覆盖：方法名映射、运行时读取 `window.nekoIPC`、mock 覆盖兼容、旧返回字段透传。
