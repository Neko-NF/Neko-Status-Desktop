# IPC 契约规范

本文定义 Neko Status Desktop 的 IPC 设计、命名、返回值、校验和变更流程。所有主进程与 renderer 的通信都必须遵守这里的约束。

## 单一事实来源

IPC 契约集中维护在：

```text
src/shared/ipc-contracts.js
src/shared/schemas.js
```

职责：

- `IPC_CHANNELS`：renderer 主动调用主进程的 invoke channel。
- `IPC_EVENTS`：主进程推送给 renderer 的事件名。
- `createIpcSuccess(data)` / `createIpcError(code, message, details)`：主进程统一响应 helper。
- `schemas.js`：复杂 payload 的校验函数。

禁止在新代码中直接手写 channel 字符串。例外只允许存在于兼容层或明确的内部一次性通道，例如隐私窗口选择器的临时 token 事件。

## 调用链路

标准链路：

```text
renderer page
  -> renderer service
  -> IpcClient
  -> window.nekoIPC
  -> preload/index.js
  -> ipcRenderer.invoke(IPC_CHANNELS.X)
  -> src/main/ipc/*.ipc.js
  -> main service/system/store
```

页面层只依赖 renderer service，不直接访问 `ipcRenderer`、`window.nekoIPC` 或 channel 字符串。

## 命名规则

Invoke channel 使用以下形式：

```text
domain:action
domain:resource:action
```

示例：

```text
config:get
config:setMany
service:start
system:metrics
stream:testObsWs
update:download
```

Event channel 使用领域前缀：

```text
service:tick
service:statusChanged
update:progress
startup-update:status
system:metricsUpdate
```

命名要求：

- channel 必须表达业务语义，不使用 UI 控件名。
- invoke channel 表达请求；event channel 表达状态变化或推送。
- 删除或替换 channel 前必须先迁移调用方。

## 返回结构

主进程 handler 默认返回统一结构：

```js
{ ok: true, data: value }
```

失败返回：

```js
{
  ok: false,
  error: {
    code: 'ERROR_CODE',
    message: 'Human readable message',
    details: {}
  }
}
```

Preload 的 `invokeCompat()` 会对 `{ ok, data, error }` 做兼容解包，让已有 renderer 代码继续读取历史字段。新增 renderer service 应优先面向业务结果，而不是重复解析主进程包装结构。

## Payload 校验

复杂 payload 必须在 `src/shared/schemas.js` 定义校验函数。当前已覆盖的领域包括：

- update download / install
- auth login / register / update profile
- config get / set / setMany
- stream save config / test SRS / test OBS / apply OBS

规则：

- 标量参数可以直接校验类型。
- 对象 payload 必须检查必填字段、枚举、端口、URL、文件路径等边界。
- 校验失败应返回 `createIpcError()`，不要静默忽略。
- schema 变更必须补测试。

## 主进程注册规则

所有 handler 放在 `src/main/ipc/*.ipc.js`：

```text
config.ipc.js
api.ipc.js
auth.ipc.js
stream.ipc.js
system.ipc.js
service.ipc.js
update.ipc.js
```

统一由 `src/main/ipc/index.js` 注册。禁止在 `main.js` 新增内联 handler。

新增 handler 时应遵循：

1. 在 `src/shared/ipc-contracts.js` 增加 `IPC_CHANNELS`。
2. 必要时在 `schemas.js` 增加 payload 校验。
3. 在对应 `src/main/ipc/*.ipc.js` 注册 handler。
4. 在 `src/preload/index.js` 暴露最小 renderer API。
5. 在 `src/renderer/js/services/*` 增加业务方法。
6. 页面通过 service 调用。
7. 补单测与文档。

## Renderer service 规则

Renderer services 是页面访问后端能力的唯一入口。

```text
src/renderer/js/services/ipc-client.js
src/renderer/js/services/api-client.js
src/renderer/js/services/config-client.js
src/renderer/js/services/auth-client.js
src/renderer/js/services/service-client.js
src/renderer/js/services/system-client.js
src/renderer/js/services/stream-client.js
src/renderer/js/services/update-client.js
```

约束：

- service 通过 `IpcClient.invoke()` 调用 preload 暴露方法。
- service 可以做业务命名封装，例如 `ConfigClient.setDashboardLayout(layout)`。
- page 不直接调用 `window.nekoIPC`。
- `IpcClient` 是唯一允许读取 `window.nekoIPC` 的通用入口。
- 显式 mock 应尽量放在对应 service 或 page 的测试入口中，不污染真实业务路径。

## 事件监听规则

Renderer 监听主进程事件时使用：

```js
IpcClient.on(IPC_EVENTS.UPDATE_PROGRESS, handler)
```

事件名从 `window.__NEKO_IPC_CONTRACTS__.IPC_EVENTS` 读取。新增事件必须同步：

- `src/shared/ipc-contracts.js`
- main 推送点
- preload 暴露的 `IPC_EVENTS`
- renderer 监听点
- 测试或 smoke 验证

## 特殊通道

隐私窗口选择器使用一次性 token 通道：

```text
privacy-picker-result-${token}
```

它只服务于 `src/main/app-shell.js` 与 `src/preload/privacy-picker.js`，不作为普通 renderer API 对外开放。

## 废弃流程

废弃 IPC 不能直接删除。流程：

1. 在文档中标记废弃原因和替代接口。
2. 替换 renderer service / page 调用方。
3. 保留一个兼容窗口期，必要时保留 preload alias。
4. 删除主进程 handler。
5. 删除 preload 暴露方法。
6. 删除 `IPC_CHANNELS` 常量。
7. 更新测试、文档和 PR 描述。

## 验收清单

涉及 IPC 的 PR 至少确认：

- `npm run verify` 通过。
- `npm run test:smoke` 通过。
- 新 channel 在 `IPC_CHANNELS` 或 `IPC_EVENTS` 中定义。
- 主进程 handler 使用统一响应结构。
- 复杂 payload 有 schema。
- Renderer 页面没有新增直接 `window.nekoIPC` 调用。
- 文档说明了新增或废弃的接口。
