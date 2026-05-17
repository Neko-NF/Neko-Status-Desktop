# IPC 契约说明

## 1. 单一来源

当前 IPC 常量统一维护在：

- `src/shared/ipc-contracts.js`

主进程、preload 和 renderer 都应引用这里的常量：

- 主进程注册：`ipcMain.handle(IPC_CHANNELS.X, handler)`
- preload 暴露：`ipcRenderer.invoke(IPC_CHANNELS.X, payload)`
- renderer 调用：只通过 `window.nekoIPC`，不直接拼 invoke channel 字符串
- renderer 监听主进程事件：优先使用 preload 暴露的 `window.__NEKO_IPC_CONTRACTS__.IPC_EVENTS`，不要在 `app-ipc.js` 等文件中新增硬编码事件名

Renderer 访问方式统一通过：

- `window.nekoIPC`
- 暴露来源：`src/preload/index.js`

主进程发给 renderer 的事件名也统一来自 `IPC_EVENTS`，不要在新代码里继续散落硬编码字符串。`src/main/main.js` 中的主 IPC 注册已迁移到 `IPC_CHANNELS`，后续拆分到 `src/main/ipc/*` 时也必须沿用同一套常量。

当前已拆分的主进程 IPC 模块：

- `config.ipc.js`：配置读写
- `api.ipc.js`：API 连通性、设备配对、设备元数据同步与密钥校验
- `auth.ipc.js`：用户认证与设备密钥生成
- `stream.ipc.js`：推流与 OBS 集成
- `system.ipc.js`：截图、窗口、系统信息、缓存、通知、字体、应用控制
- `service.ipc.js`：上报服务控制、开机自启、进程信息、权限检测、一键体检
- `update.ipc.js`：更新检查、通道管理、下载、安装、待安装管理、Changelog、完整性、版本回滚

主进程 IPC 拆分已全部完成。`main.js` 中不再保留任何内联 IPC handler。

## 2. 命名规则

- invoke channel：`domain:action` 或 `domain:resource:action`
- event channel：使用可读的领域事件名，例如 `service:tick`

示例：

- `config:get`
- `service:start`
- `update:download`
- `system:metricsUpdate`

## 3. 当前结果结构

仓库仍处于迁移期，历史 handler 返回值并不完全统一。当前已收敛到标准结构的领域包括 `api`、`auth`、`config`、`stream`、`system`、`service` 和大部分 `update` handler。

新接口或改造接口应尽量使用：

```js
{ ok: true, data: ... }
```

或：

```js
{
  ok: false,
  error: {
    code: 'ERROR_CODE',
    message: 'human readable message',
  },
}
```

辅助函数位于：

- `createIpcSuccess`
- `createIpcError`

## 4. Payload 校验

跨层 payload 校验集中放在：

- `src/shared/schemas.js`

当前已落地：

- `update:download`
- `update:install`
- `auth:login`
- `auth:register`
- `auth:updateProfile`
- `config:get`
- `config:set`
- `config:setMany`
- `stream:saveConfig`
- `stream:testSrs`
- `stream:testObsWs`
- `stream:applyToObs`

规则是：

- 只要 payload 不是简单标量，就优先补 schema
- 校验失败时，由主进程返回结构化错误，而不是静默吞掉

## 5. 特殊通道说明

### 隐私窗口选择器

隐私窗口选择器使用临时 token 形成一次性事件通道：

- `privacy-picker-result-${token}`

它不对 renderer 主页面开放，而是只由：

- `src/main/app-shell.js`
- `src/preload/privacy-picker.js`

这组主进程壳层逻辑内部消费。

### 更新事件

更新相关事件现在应优先复用：

- `IPC_EVENTS.UPDATE_PROGRESS`
- `IPC_EVENTS.UPDATE_AVAILABLE`
- `IPC_EVENTS.UPDATE_FORCE_INSTALL_STARTED`
- `IPC_EVENTS.UPDATE_AUTO_DOWNLOADED`
- `IPC_EVENTS.UPDATE_AUTO_DOWNLOAD_FAILED`
- `IPC_EVENTS.STARTUP_UPDATE_STATUS`

`STARTUP_UPDATE_STATUS` 仅用于启动前更新窗口展示阶段状态；下载进度仍复用 `UPDATE_PROGRESS`，避免为同一进度语义新增第二套事件。

## 6. 新增 IPC 的步骤

1. 在 `src/shared/ipc-contracts.js` 添加 channel 或 event 常量。
2. 如有复杂 payload，在 `src/shared/schemas.js` 添加校验。
3. 在 `src/preload/index.js` 暴露 renderer 可调用方法。
4. 在 `src/main/ipc/*.ipc.js` 中使用 `IPC_CHANNELS` 注册 handler，并从 `src/main/ipc/index.js` 导出。
5. 在 renderer 通过 `window.nekoIPC` 调用。
6. 同步更新测试与文档。

## 7. 废弃 IPC 的步骤

1. 先替换调用方。
2. 保留一段兼容窗口期。
3. 删除 preload 暴露。
4. 删除主进程 handler。
5. 更新测试与文档。

## 8. 前后端桥接防错

详见 [前后端桥接故障复盘与防错清单](./frontend-backend-integration-guardrails.md)。

新增或修改 IPC 时，必须额外确认：

- 主窗口 preload 没有进入降级 stub，启动日志不得出现 `preload bridge missing`。
- renderer 只通过 `window.nekoIPC` 调用能力，不直接使用 `ipcRenderer`。
- renderer 不直接使用 `process`、`require` 或 Node/Electron 全局对象；需要运行时信息时由 preload 暴露只读对象。
- main handler 默认返回 `createIpcSuccess(data)` / `createIpcError(...)`，preload 负责解包兼容，renderer 不直接解析 main 层包装。
- 页面字段和后端字段必须逐项对齐，尤其是 `ok`、`success`、`data`、`isRunning` 等易混字段。
# Renderer service 约定

- 新增 renderer IPC 调用时，优先在 `src/renderer/js/services/*` 新增业务 client，由 service 访问 `window.nekoIPC`。
- `pages/*` 只调用 service，不直接拼 channel 字符串；迁移期保留的 `app-ipc.js` 调用点逐步收敛。
- `scripts/verify.js` 会扫描整个 `src/renderer` 的 JS 文件，避免 `app-ipc.js`、`services`、`pages` 中重新出现硬编码 `ipc.on('...')` 事件名。
