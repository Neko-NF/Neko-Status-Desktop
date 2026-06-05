# Neko Status Desktop 架构说明

本文说明当前 Electron 桌面端的真实工程结构、模块边界和后续演进原则。它不是改造日志，而是团队开发时判断“代码应该放在哪里”的基准。

## 架构结论

Neko Status Desktop 已经从早期单体脚本逐步拆成以下四层：

```text
src/
  main/       Electron 主进程，本地后端、系统能力、服务编排、IPC 注册
  preload/    Renderer 安全桥接层，只暴露白名单 API
  renderer/   前端 UI、页面交互、renderer services
  shared/     IPC 常量、事件名、payload schema、跨层契约
```

当前项目已经基本达到任务文档期望的工程化方向：主进程 IPC 已按领域模块化，preload 安全桥已落地，renderer 已按 `services/pages/components/core/state` 拆分，测试、CI、PR 模板和发布流程也已经具备。`app.js` / `app-ipc.js` 已退成极薄启动入口，renderer 运行时装配由 `core/app-runtime.js` 承担。

## 主进程

主进程扮演“本地后端”的角色。Renderer 不直接访问 Node、Electron、文件系统、系统窗口或进程能力。

主要文件：

```text
src/main/main.js                  应用启动、生命周期、服务装配、更新编排
src/main/app-shell.js             主窗口、托盘、隐私窗口选择器、初始状态下发
src/main/startup-update-gate.js   启动前更新检查与放行策略
src/main/config-store.js          配置读写入口
src/main/config-store.helpers.js  默认配置、合并、兼容修复
src/main/api-service.js           后端 HTTP/API 通信
src/main/status-service.js        状态上报服务
src/main/stream-service.js        推流与 OBS 集成
src/main/system-utils.js          截图、窗口、指标、系统信息等能力
src/main/ipc/*.ipc.js             各领域 IPC handler
```

截图能力由主进程统一采集和压缩。`system-utils.captureScreen({ includeMetadata: true })` 返回图片 Buffer、真实 MIME、扩展名和压缩统计；上报、IPC 预览和活动流必须使用这些元数据，不能在 renderer 侧假定截图永远是 PNG。Developer Mode 可以保存截图采集分辨率、上传格式（auto/JPG/PNG）、压缩目标、降级阈值、上报上限、JPEG 质量、JPEG 最低质量和分辨率下限，但实际采集与上报仍由主进程执行。状态上报客户端使用 multipart `screenshot` 字段并设置真实 MIME/扩展名；后端截图上传文档也声明文件支持 PNG/JPEG。

IPC 模块按领域拆分：

```text
src/main/ipc/
  index.js       统一注册入口
  config.ipc.js  配置读写
  api.ipc.js     API 连通性、设备配对、设备元数据、密钥校验
  auth.ipc.js    登录、注册、用户状态、设备密钥生成
  stream.ipc.js  推流配置、SRS、OBS 集成
  system.ipc.js  截图、窗口、缓存、通知、字体、应用控制
  service.ipc.js 上报服务、开机自启、进程信息、权限、体检
  update.ipc.js  更新检查、下载、安装、回滚、完整性检查
```

主进程新增能力时优先落在对应 service / system / ipc 模块中。`main.js` 只做启动和编排，不继续承接新业务 handler。

## Preload

Preload 是 renderer 到主进程的唯一安全桥。

```text
src/preload/index.js          暴露 window.nekoIPC、IPC 常量、运行时版本
src/preload/privacy-picker.js 隐私窗口选择器专用 preload
```

安全约束：

- 主窗口使用 `contextIsolation: true`。
- Renderer 不能直接使用 `ipcRenderer`、`require`、`process`、`fs`。
- 新增主进程能力必须经过 `shared -> main ipc -> preload -> renderer service`。
- `src/renderer/js/ipc-bridge.js` 只是降级兜底，不能作为功能验收依据。

## Renderer

Renderer 是前端 UI 层。当前结构：

```text
src/renderer/
  index.html
  startup-update.html
  css/
    main.css
    tokens.css
    base.css
    layout.css
    components.css
    pages.css
    legacy.css
  js/
    app.js
    app-ipc.js
    ipc-bridge.js
    core/
    services/
    components/
    state/
    pages/
```

当前职责划分：

- `app.js`：瘦身后的启动装配入口，只挂载 renderer bootstrap 元信息。
- `components/app-shell-controls.js`：顶部栏、侧边栏、全局步进器、配置/资料弹窗等 shell 层 DOM 绑定；导航、主题、弹窗能力分别委托给 `core/router.js`、`core/theme.js`、`components/modal.js`。
- `app-ipc.js`：兼容启动器，只在 DOM ready 后启动 `core/app-runtime.js`。
- `core/app-runtime.js`：renderer 运行时装配层，负责把 services、pages、components、`AppInitRuntime` 和 `AppEventRuntime` 接线；不承接页面专属 DOM 行为。
- `services/*`：renderer 侧业务 client，统一调用 `IpcClient`。
- `pages/*`：页面 DOM、交互和渲染逻辑。
- `components/*`：可复用 UI 或命令组件。
- `core/*`：路由、主题、事件总线等基础设施。
- `state/*`：跨页面状态容器。

已拆出的重要 renderer 模块：

```text
services/ipc-client.js
services/api-client.js
services/config-client.js
services/auth-client.js
services/service-client.js
services/system-client.js
services/stream-client.js
services/update-client.js

pages/auth.page.js
pages/config.page.js
pages/dashboard.page.js
pages/device-status.page.js
pages/screenshot.page.js
pages/settings.page.js
pages/service.page.js
pages/stream.page.js
pages/update.page.js
pages/about.page.js

components/developer-console.js
components/console-runtime.js
components/experimental-features.js
components/security-dialogs.js
components/expandable-section.js
components/modal.js
components/neko-island.js
components/ui-helpers.js

core/app-init-runtime.js
core/app-event-runtime.js
core/app-runtime.js
```

## Shared 契约

```text
src/shared/ipc-contracts.js  IPC channel、event、统一响应 helper
src/shared/schemas.js        payload 校验
```

所有 IPC channel 和主进程推送事件必须从 `src/shared/ipc-contracts.js` 取常量。复杂 payload 必须在 `schemas.js` 增加校验。

## 启动与更新

启动流程简化为：

1. Electron app ready。
2. 创建必要服务和 IPC 注册。
3. 运行 `startup-update-gate`。
4. 如需展示启动更新窗口，则打开 `startup-update.html`。
5. 无待处理更新或失败放行时，打开主窗口。
6. Renderer 通过 preload 获取初始配置和主进程事件。

启动更新窗口仅用于检查、下载、安装、失败放行状态展示。它通过 preload 监听 `IPC_EVENTS.STARTUP_UPDATE_STATUS` 和 `IPC_EVENTS.UPDATE_PROGRESS`，不直接访问 Electron API。

## 测试与质量门禁

核心命令：

```bash
npm test
npm run verify
npm run test:smoke
npm run build:zip
```

当前质量基线：

- `npm test` 覆盖 IPC、schema、配置合并、renderer services、页面 VM 测试、启动更新 gate。
- `npm run verify` 覆盖文件结构、renderer 模块语法、HTML/CSS 关键结构、编码污染、配置默认值、IPC 一致性。
- `npm run test:smoke` 启动最小 Electron 隐藏窗口，验证 preload bridge 和基础 IPC round-trip。
- `.github/workflows/ci.yml` 与 `build-check.yml` 提供 PR 质量门禁。

## 当前达成度

| 目标 | 状态 | 说明 |
| --- | --- | --- |
| 主进程 IPC 模块化 | 已达成 | IPC handler 已按领域拆入 `src/main/ipc/*` |
| Preload 安全桥 | 已达成 | 主窗口和隐私选择器均使用 preload |
| IPC 契约集中管理 | 已达成 | `IPC_CHANNELS` / `IPC_EVENTS` 已集中 |
| Renderer services | 基本达成 | 业务页面已优先走 services，旧协调层仍在迁移 |
| `app.js` / `app-ipc.js` 瘦身 | 基本达成 | `app.js` 已瘦身为 bootstrap；`app-ipc.js` 已退成兼容启动器；运行时装配迁入 `core/app-runtime.js`。shell 控制、公告弹窗轮询、关于页渲染、密钥安全弹窗、控制台 runtime、实验性入口、`APP_INIT` 同步、主进程事件转发、仪表盘运行时、设备状态诊断、服务/自启/体检、截图控制、核心设置、更新中心等职责已迁入对应 `pages/*`、`components/*` 或 `core/*` |
| CSS 分层 | 持续推进 | `main.css` 已作为入口，tokens/base/layout/components/pages 分层生效；重复 design tokens/base 块和服务页等明确样式已从 `legacy.css` 迁出 |
| Electron smoke test | 已达成 | `npm run test:smoke` 可验证 preload/IPC |
| PR CI 与模板 | 已达成 | CI、build-check、release、PR/Issue 模板已存在 |
| 团队文档 | 已达成并持续维护 | 以本目录核心文档为准 |

## 后续演进原则

- 新页面放入 `src/renderer/js/pages`，不要写回 `app.js`。
- 新页面 DOM 状态、事件绑定、输入解析和渲染逻辑必须优先放入 `pages/*` 或 `components/*`；跨模块装配放入 `core/app-runtime.js`，不要写回 `app-ipc.js`。
- 新 IPC 调用放入 `src/renderer/js/services`，页面不直接调用 `window.nekoIPC`。
- 新主进程 handler 放入对应 `src/main/ipc/*.ipc.js`，不要写回 `main.js`。
- 新配置项必须同步默认值、schema、测试、文档。
- 新 UI 状态必须有可复现测试路径：单测、smoke、dev scenario 或手工验收说明。
