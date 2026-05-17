# 架构说明

## 分层

当前仓库按四层组织：

- `main`：Electron 主进程，负责窗口、托盘、系统能力、服务编排与 IPC 注册
- `preload`：主进程到 renderer 的安全桥接层
- `renderer`：桌面端 UI 与交互逻辑
- `shared`：跨层共享的 IPC 常量、事件名与 payload 校验

## 当前目录重点

### Main

- `src/main/main.js`
  负责应用启动、生命周期、自动更新编排（启动时检查/轮询/后台下载），以及版本比较与通道过滤工具函数
- `src/main/startup-update-gate.js`
  负责启动窗口前的自动更新门禁：先处理已下载待安装包，再执行有限时长的更新检查；有可安装更新时启动安装器并由安装器完成后重开应用，检查失败、无网络、无安装包或开发模式自动安装被禁用时必须放行打开主窗口
  开发版支持 `NEKO_DEV_STARTUP_UPDATE_SCENARIO` / `--dev-startup-update=` 场景注入，用于复现启动更新检查、发现更新、下载进度、安装交接和失败放行 UI；该入口只能在未打包环境生效
- `src/main/app-shell.js`
  承担窗口创建、托盘菜单、初始状态下发、隐私窗口选择器等 UI 壳层职责
- `src/main/config-store.js`
  配置存取入口
- `src/main/config-store.helpers.js`
  默认配置、合并与兼容辅助
- `src/main/system-utils.js`
  系统窗口、截图、性能指标等能力
- `src/main/api-service.js`
  后端 API 通信
- `src/main/status-service.js`
  状态上报服务
- `src/main/stream-service.js`
  推流与 OBS 集成
- `src/main/ipc/index.js`
  IPC 注册入口，汇总各领域 IPC 模块
- `src/main/ipc/config.ipc.js`
  配置读写 IPC
- `src/main/ipc/api.ipc.js`
  API 连通性、设备配对、设备元数据同步与密钥校验 IPC
- `src/main/ipc/auth.ipc.js`
  登录、注册、用户状态与设备密钥生成 IPC
- `src/main/ipc/stream.ipc.js`
  推流和 OBS 集成 IPC
- `src/main/ipc/system.ipc.js`
  截图、窗口、系统信息、缓存、通知、字体和应用控制 IPC
- `src/main/ipc/service.ipc.js`
  上报服务控制、开机自启、进程信息、权限检测与一键体检 IPC
- `src/main/ipc/update.ipc.js`
  更新检查、通道管理、下载、安装、待安装管理、Changelog、完整性与版本回滚 IPC

### Preload

- `src/preload/index.js`
  暴露 `window.nekoIPC`
- `src/preload/privacy-picker.js`
  仅服务于隐私窗口选择器，负责把选择结果安全回传主进程

### Renderer

- `src/renderer/index.html`
  页面入口
- `src/renderer/startup-update.html`
  启动前自动更新的轻量状态窗口入口，只展示检查、下载、安装和失败放行状态；通过 preload 暴露的事件监听 `IPC_EVENTS.STARTUP_UPDATE_STATUS` / `IPC_EVENTS.UPDATE_PROGRESS`，不直接访问 Electron API
- `src/renderer/js/app.js`
  视图层与基础交互
- `src/renderer/js/app-ipc.js`
  页面与 IPC 的真实接线
- `src/renderer/js/ipc-bridge.js`
  兼容层，优先转发到 preload 暴露的能力
- `src/renderer/js/components/ui-helpers.js`
  Renderer 通用 UI helper 第一阶段拆分，负责折叠动画、字体 profile 和服务体检文案标准化，并继续通过 `window._nekoUIHelpers` 兼容旧调用点

### Shared

- `src/shared/ipc-contracts.js`
  IPC invoke channel 与 event channel 的单一来源
- `src/shared/schemas.js`
  跨层 payload 校验

## 关键边界

### 主进程壳层边界

以下职责已经从 `main.js` 拆到 `app-shell.js`：

- 主窗口创建与展示逻辑
- 托盘创建与托盘菜单刷新
- 初始应用状态推送
- 隐私窗口选择器

这样 `main.js` 可以更多聚焦业务编排，而不是继续堆积窗口细节。

### 安全边界

- 主窗口已通过 `preload + contextIsolation` 暴露能力给 renderer
- 隐私窗口选择器也已切换到独立 preload，不再在内联页面中直接 `require('electron')`
- renderer 新增能力时，优先走 `shared -> preload -> main` 这条链路

### IPC 边界

- channel 常量统一维护在 `src/shared/ipc-contracts.js`
- 主进程注册、preload 调用和 renderer 入口均使用 `IPC_CHANNELS` / `IPC_EVENTS`
- 更新下载与安装的 payload 已接入 `src/shared/schemas.js`
- 主进程推送事件优先复用 `IPC_EVENTS` 常量，避免字符串散落
- 所有领域 IPC 必须放在 `src/main/ipc/*.ipc.js`，并从 `src/main/ipc/index.js` 统一导出

## 当前迁移状态

项目不是一次性重写，而是持续工程化迁移：

- **已完成**：preload 安全桥、共享 IPC 契约、主进程 IPC 注册常量化、主进程壳层拆分、隐私选择器 preload 化、所有主进程 IPC 领域模块化（config / api / auth / stream / system / service / update）、更新/auth/config/stream payload 校验、renderer 通用 UI helper 第一阶段组件化、基础测试、编码污染扫描与 CI 入口
- **主进程 IPC 拆分完成**：`main.js` 中不再保留任何内联 IPC handler，所有 IPC 均通过 `src/main/ipc/*.ipc.js` 模块注册
- **IPC 契约继续收敛**：auth 和 config 读写已改为主进程统一返回 `{ ok, data, error }`，preload 继续负责兼容解包，renderer 仍可读取既有的业务字段
- **Renderer 第一阶段拆分**：`src/renderer/js/components/ui-helpers.js` 已承接可复用 UI helper；`app.js` 仍保留旧实现作为兜底，但运行时优先使用组件目录中的 helper
- **下一步重点**：把 renderer 从 `app.js / app-ipc.js` 逐步拆成更清晰的 `pages / services / state / components` 结构

## 前后端桥接边界补充

详见 [前后端桥接故障复盘与防错清单](./frontend-backend-integration-guardrails.md)。

本次修复确认了一个关键边界：窗口能显示不代表前后端链路可用。主窗口必须保证 preload 正常加载，`window.nekoIPC` 才是 renderer 与 main 通信的唯一可信入口。

架构约束：

- `BrowserWindow.webPreferences` 必须保持 `contextIsolation: true`。
- 主 preload 依赖 Node 能力时，必须显式设置 `sandbox: false`，否则 Electron 新版本会让 preload 进入沙盒并导致桥接失败。
- renderer 不得直接访问 `process`、`require`、`ipcRenderer`、`fs` 等 Node/Electron 能力。
- 运行时版本、系统能力、文件保存、截图等能力必须通过 preload 暴露的最小 API 转发。
- `ipc-bridge.js` 的 fallback 只用于防崩溃，不可作为功能验收依据。
# 2026-05 Renderer service 进展

- `src/renderer/js/services/ipc-client.js` 已作为 renderer IPC 基础 client，负责运行时查找 `window.nekoIPC` 并统一缺失方法报错。
- `src/renderer/js/services/stream-client.js` 已封装直播推流页使用的 stream IPC 方法，保留原返回结构透传以兼容既有 UI 判断。
- `src/renderer/js/pages/stream.page.js` 已从直接访问 `window.nekoIPC` 改为调用 `StreamClient`。
- `src/renderer/js/pages/settings.page.js` 已承接设置页字体选择器，`app.js` 中对应旧绑定保持停用兜底，避免重复事件绑定。
