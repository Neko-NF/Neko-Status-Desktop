# 前后端桥接故障复盘与防错清单

本文件记录 2026-05 仪表盘、控制台、推流页修复时暴露的根本问题。后续涉及 Electron 主进程、preload、renderer、IPC 或页面功能时，必须按本清单核对。

## 根本问题

### 1. preload 没有真正加载，renderer 进入降级模式

现象：
- 窗口可以打开，但按钮、开关、状态卡没有真实功能。
- 日志出现 `preload bridge missing or incomplete`。
- `window.nekoIPC` 缺失或只剩 fallback stub。

根因：
- Electron 新版本下 preload 被沙盒化后，preload 里使用 `require('path')` 等 Node 能力会失败。
- 主窗口没有明确设置 `webPreferences.sandbox: false`，导致桥接层没有加载。

防错规则：
- 主窗口必须保持 `contextIsolation: true`。
- preload 需要 Node 能力时，主窗口必须显式设置 `sandbox: false`。
- renderer 不得直接依赖 fallback stub 来证明功能可用；fallback 只用于避免页面崩溃。
- 开发版启动后必须确认日志里没有 `preload bridge missing`。

### 2. IPC 返回结构不统一

现象：
- 后端 handler 已执行，但前端判断失败。
- 前端有的地方读 `success`，有的地方读 `ok`，有的地方期望直接布尔值或业务对象。

根因：
- 重构期间 main IPC handler、preload、renderer 对返回值约定不一致。
- 部分 handler 返回 `{ ok, data }`，但 renderer 仍按旧结构读取。

防错规则：
- main handler 默认返回 `createIpcSuccess(data)` 或 `createIpcError(code, message, details)`。
- preload 负责兼容解包，让 renderer 调用 `window.nekoIPC.xxx()` 时拿到业务数据或兼容错误对象。
- 新增或修改 IPC 时，必须同步更新 `src/shared/ipc-contracts.js`、`src/preload/index.js`、`src/main/ipc/*.ipc.js`、renderer 调用点和单元测试。

### 3. renderer 直接读取 Node 全局对象

现象：
- renderer 初始化中断。
- 日志出现 `process is not defined`。

根因：
- 在 `contextIsolation` 下，renderer 不能直接访问 Node 全局对象。
- 页面代码直接读取 `process.versions`。

防错规则：
- renderer 不得直接使用 `process`、`require`、`ipcRenderer`、`fs` 等 Node/Electron 对象。
- 必要运行时信息由 preload 暴露只读对象，例如 `window.nekoRuntime.versions`。
- 提交前应确认 `src/renderer` 中没有新增 `process.` 或 `require(`。

### 4. UI 初始化污染业务统计

现象：
- 仪表盘刚打开，上传健康度被错误计算。

根因：
- 局部 UI 刷新复用了真实 tick 处理函数，导致初始化电量刷新也进入上传成功率统计。

防错规则：
- 页面刷新函数要区分“真实业务事件”和“初始化/局部刷新”。
- 会累计统计、写活动流、触发告警的函数必须提供明确选项或单独入口。

### 5. 看得见的按钮没有后端通道

现象：
- 控制台“导出日志”等按钮存在，但没有 id、没有事件、没有 IPC。

根因：
- UI 先行后，未做页面功能到后端能力的逐项审查。

防错规则：
- 每个可点击控件必须能回答：DOM id 是什么、renderer handler 在哪里、preload 方法是什么、main handler 在哪里、失败态如何展示。
- 没有真实功能的控件不得作为正式功能露出；若必须占位，应明确 disabled 或隐藏。

### 6. 开发启动参数掩盖性能问题

现象：
- 为绕过 GPU 崩溃使用软件渲染后，界面明显卡顿。
- 在受限/沙箱环境里直接跑 `npm run dev`，日志出现 `GPU process exited unexpectedly`、`GPU process isn't usable. Goodbye.`，但临时构建出的 `dist/win-unpacked/NekoStatus.exe` 可以正常打开。

根因：
- 默认关闭硬件加速会让整个 UI 走软件渲染。
- 截图权限被拒绝时，自动截图反复失败也会拖慢后台循环。
- GUI 程序必须在真实桌面/GUI 权限下验证；受限 shell 或沙箱里启动 Electron dev binary，可能触发 Chromium GPU 子进程失败，和业务代码、preload、IPC 失败不是同一种问题。
- 开发版 `node_modules/electron` 与打包后的 `NekoStatus.exe` 启动路径不同，不能只凭其中一个结果直接推断另一个必然损坏。

防错规则：
- 不要默认禁用硬件加速。`scripts/start-electron.js` 会先按正常 GPU 路径启动；只有捕获到 GPU fatal 时才自动用软件渲染兜底重试。需要人工强制兜底时才设置 `NEKO_DISABLE_HW_ACCEL=1`。
- 验证 dev 可用性时，必须用真实 GUI 启动方式执行 `npm run dev`，不要用普通受限 shell 里的超时命令当作唯一结论。
- 如果 dev 报 GPU fatal，先临时执行 `npm run build` 并启动 `dist/win-unpacked/NekoStatus.exe` 对照；正式 exe 正常且 dev 仅在受限环境失败时，优先排查启动环境、GPU 参数和 Electron dev binary，不要先回滚业务代码。
- 如果日志出现 `preload bridge missing`、`process is not defined`、renderer exception、IPC handler missing，才优先按前后端桥接问题排查。
- 对可能失败且代价高的系统能力加退避，例如截图失败后也要更新时间戳，避免紧密重试。

### 7. 条件型 UI 没有可重复触发入口

现象：
- 启动更新、权限失败、下载进度、后台服务异常等界面只有在真实异常或真实发布时才出现，开发者平时很难审查。
- 前端看起来有 UI，但没有真实主进程事件、preload 事件或失败放行路径覆盖。

根因：
- 条件型 UIUX 被当成普通静态页面做，没有纳入前后端契约测试。
- 开发版缺少确定性的场景注入，只能靠改代码、断网或手工制造异常验证。

防错规则：
- 每个条件型 UI 必须有确定性的开发版触发入口或单元测试。
- 触发入口必须经过真实主进程分发和 preload 桥接，不能只在 renderer 里 mock DOM。
- 开发场景只能在未打包环境生效，生产逻辑不得被测试入口短路。
- 启动前更新 UI 已提供 `--dev-startup-update=checking|available|download|failed|offline|up-to-date|installing`；新增类似能力时要同步补命令、测试和文档。

## 页面级审查模板

逐页修复时按以下顺序执行：

1. 列出页面所有按钮、开关、输入框、状态卡和事件列表。
2. 对每个交互确认 renderer handler，不允许只停留在 mock 或纯 UI 切换。
3. 对每个 handler 确认 `window.nekoIPC` 方法存在。
4. 对每个 preload 方法确认 `IPC_CHANNELS` 常量和 main handler 存在。
5. 对每个 main handler 确认返回字段与 renderer 使用字段一致。
6. 验证失败态：无权限、无配置、网络失败、用户取消都不能让页面假成功。
7. 补最小单元测试，至少覆盖返回结构和兼容字段。
8. 用 dev 版启动检查日志，确认没有 preload 缺失、renderer 初始化错误或 IPC 未处理错误。
9. 对条件型 UI，用对应开发场景命令复现至少一个成功态和一个失败放行态。

## 提交前必跑

```bash
node --check src/preload/index.js
node --check src/renderer/js/app-ipc.js
node --check src/renderer/js/core/app-runtime.js
npm run lint
node --test --test-concurrency=1 "tests/unit/*.test.js"
```

如果 Windows 上 `npm test` 并发模式偶发 `VirtualAlloc failed`，需要用串行模式复核。串行通过且单文件通过时，优先判断为本机并发资源问题，而不是业务断言失败。
## 更新源与安装器边界

更新源 UI 与后端逻辑必须保持同步：

- 前端允许保存 GitHub 仓库 URL 和个人服务器仓库 URL。
- 前端更新源控件必须通过 `updateSources`、`activeUpdateSourceId` 和 `updateSourceMode` 持久化状态。
- GitHub 配置和个人仓库配置必须隔离保存。切换个人仓库不能覆盖 `githubOwner` / `githubRepo`；切回 GitHub 也不能删除个人仓库配置。
- `updateSourceMode=selected` 表示检查更新时使用用户选中的更新源。
- `updateSourceMode=smart` 表示后端检查所有启用的已保存更新源，并返回健康且更快的结果。
- renderer 必须使用后端返回的下载 URL，不能在前端重新推导下载源。
- 自动更新开启、自动更新关闭、启动检查、后台检查、手动检查、强制更新、手动下载和本地安装必须共享后端更新源 helper。
- GitHub token 和个人仓库 token 必须按 URL / source type 隔离，不能交叉使用。
- 更新源“预估下载速度”只能由主进程对真实安装资产做流式采样得出；不得在 renderer 侧估算，也不得用 Release API JSON 响应速度代替。
- 资产测速必须优先使用 Range 小样本请求；Range 不可用时只能降级到普通流式采样并主动截断，不能完整下载大安装包。
- 个人 Gitea 仓库可以使用 release，也可以只在仓库根目录存放 `.exe`、`.zip`、`.7z`、`.blockmap` 和校验文件。
- 个人仓库根目录兜底模式必须支持 `release_notes.txt`；`https://git.koirin.com:39520/NF/Neko` 发版只需要新版本文件和更新说明。

安装器交接规则：

- 手动安装必须支持用户选择 `.exe`、`.zip` 和 `.7z`。
- 手动 `.exe` 应交互式启动；自动下载的 `.exe` 可以静默启动。
- `.zip` 必须由主进程解压，然后拉起内部安装器或 NekoStatus 可执行文件。
- NSIS 自动安装默认通过 `/S --force-run` 交给安装器在完成后拉起新版本，避免额外隐藏 PowerShell watcher 触发安全软件误判；只有显式设置 `NEKO_UPDATE_RELAUNCH_STRATEGY=watcher` 时才启用 watcher 兜底。

发布前至少使用以下开发者控制台命令验证一次 GitHub 源和个人仓库源：

```text
update source
update check
update pending
update integrity
api test [serverUrl]
config set <key> <json|string>
```
