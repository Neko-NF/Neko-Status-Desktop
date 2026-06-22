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
activity.ipc.js
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
src/renderer/js/services/activity-client.js
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

## 用户关注活动 IPC

活动功能的 Electron IPC 只负责配置、代理控制和服务端管理接口转发，不实现前台应用检测或实时事件长连接。

Invoke channel：

| 常量 | channel | 用途 |
| --- | --- | --- |
| `ACTIVITY_GET_STATE` | `activity:getState` | 获取本地开关、代理状态、版本、PID、内存、连接状态 |
| `ACTIVITY_UPDATE_SETTINGS` | `activity:updateSettings` | 更新启用、发布、活动快照、后台、自启动设置 |
| `ACTIVITY_PROVISION_AGENT` | `activity:provisionAgent` | 通过用户登录态 enroll Agent Token 并 Provision 到代理 |
| `ACTIVITY_PAUSE_AGENT` | `activity:pauseAgent` | 临时暂停活动代理 |
| `ACTIVITY_RESUME_AGENT` | `activity:resumeAgent` | 恢复活动代理 |
| `ACTIVITY_MANAGE` | `activity:manage` | 关注、规则、隐私、公开应用、关注者、拉黑等管理动作 |
| `ACTIVITY_PICK_APP_WINDOW` | `activity:pickAppWindow` | 复用隐私窗口框选层选择要公开的应用窗口，只把进程名交给 renderer |

Event channel：

| 常量 | channel | 用途 |
| --- | --- | --- |
| `ACTIVITY_STATE_CHANGED` | `activity:stateChanged` | 主进程向 renderer 推送代理状态变化 |

`activity:manage` 的 `action` 当前包括：

```text
bootstrap
searchUsers
follow / unfollow
createRule / updateRule / deleteRule
getPrivacy / setPrivacy
getApps / upsertApp / setAppHidden
getFollowers
getBlocks / block / unblock
```

约束：

- Renderer 页面只能通过 `ActivityClient` 调用。
- `schemas.js` 必须校验 activity settings 和 manage payload。
- activity settings 的 `snapshots` 为可选布尔值；保存时同步服务端 `shareSnapshots` 和 Agent Profile，任一步失败都回滚。
- Agent Token 明文只能出现在主进程 enroll 响应到命名管道 Provision 的短链路中，不能暴露给 renderer。
- 活动实时事件使用 Agent 与 `neko-server` 的 SSE/轮询，不经过 Electron IPC 长连接。
- Renderer 可通过窗口框选后调用 `upsertApp` 主动公开某个应用，也可手填 `.exe` 进程名；`setAppHidden` 只改变 Activity 公开目录，不影响截图、完整状态上报或应用历史。
- 活动快照不经过 renderer IPC 传输；采集、上传、事件图片下载和 Toast 全部在 Agent/服务端链路内完成。

## Agent 命名管道协议

Electron 主进程与 `NekoPresenceAgent.exe` 使用当前用户命名管道通信。该协议不属于 renderer IPC，但属于本地安全边界的一部分。详细命令、ACL、DPAPI 和协议版本规则见 [Agent 本地 IPC 与安全协议](./用户关注与应用在线提醒/06_Agent本地IPC与安全协议.md)。
## 更新 IPC 说明

更新模块继续复用现有 channel：

- `update:check`
- `update:download`
- `update:install`
- `update:getPendingInstall`
- `update:installPending`
- `update:integrity`
- `update:rollback`

`update:check` 除版本信息外，还返回更新源信息：

```js
{
  hasUpdate: boolean,
  channel: 'stable' | 'beta' | 'nightly',
  sourceType: 'github' | 'personal',
  sourceLabel: string,
  releasePageUrl: string,
  currentVersion: string,
  latestVersion: string,
  exeDownloadUrl?: string,
  zipDownloadUrl?: string,
  sha256sumsUrl?: string,
  error?: string
}
```

`update:install` 接收：

```js
{
  filePath: string,
  expectedSha256?: string,
  manual?: boolean
}
```

规则：

- 主进程必须校验安装包扩展名：`.exe`、`.zip`、`.7z`。
- 已下载安装包可以在交接前进行 SHA256 校验。
- 用户通过文件选择器手动选择的安装包允许位于临时目录之外，但仍必须通过扩展名校验。
- Renderer 必须调用 `UpdateClient.install()`，不要直接调用 `window.nekoIPC.installUpdate()`。

## 更新源返回字段与诊断测速规约

`update:check` 在常规更新结果之外返回更新源诊断字段：

- `sourceMode`：`selected` 或 `smart`。
- `sourceId`：本次结果使用的已保存更新源 id。
- `sourceType`：`github` 或 `personal`。
- `sourceLabel`：用于展示和日志的更新源名称。
- `sourceLatencyMs`：该更新源探测耗时。
- `downloadSpeedBytesPerSecond`：当前更新源安装资产的下载速度预估，单位为字节每秒。该值只能来自真实资产采样，不能用 Release API JSON 响应速度代替。
- `downloadSpeedSampleBytes`：本次测速实际采样字节数。
- `downloadSpeedSampleMs`：本次测速有效传输时长，按首个数据块到采样结束计算，不包含 Release API 请求耗时。
- `downloadSpeedProbeMethod`：`range`、`full-sample`、`failed` 或 `none`。
- `smartSources`：仅智能模式返回，包含每个更新源的延迟 `sourceLatencyMs`、是否有更新 `hasUpdate`、最新版本 `latestVersion`、是否有安装资产 `hasAsset`、预估下载速度和错误信息 `error`。

### 下载速度预估机制

预估下载速度必须使用真实安装资产采样：

1. 优先选择本次更新结果中的 `.exe` 资产，缺失时使用 Windows `.zip` 资产。
2. 先带鉴权头和 `Range: bytes=0-1048575` 请求真实资产，只读取最多 1 MB。
3. 计时从首个数据块到达开始，到采样达到 1 MB、持续 2.5 秒或流结束为止。
4. 如果服务端拒绝 Range 请求，例如返回 400、416 或不返回有效数据，立即去掉 Range 头重试一次普通流式请求，并仍然只在内存中截取采样窗口。
5. 如果没有安装资产、资产请求失败或采样没有拿到数据，`downloadSpeedBytesPerSecond` 返回 `0`，前端展示“待检测”。
6. 禁止把 Release API 响应体大小、JSON 请求耗时或仓库列表请求速度当作安装包下载速度。

### 前端实时自适应诊断刷新机制
为了保障诊断界面的卡片状态与用户操作完全联动，渲染进程在执行以下 **5 个主要更新操作**时，前端将立即展示精美加载态，并在后台发起静默的 `update:check`，实时将高精度的延迟与带宽数据写回 DOM 界面：
* 切换“智能择优”与“手动选择”模式时；
* 切换源卡片芯片（Chip）时；
* 在手动模式卡片轮播中翻页改变手动源时；
* 成功新增或修改保存更新源时；
* 成功删除更新源时。

## 历史更新源返回字段（参考）

`update:check` 在常规更新结果之外返回更新源诊断字段：

- `sourceMode`：`selected` 或 `smart`。
- `sourceId`：本次结果使用的已保存更新源 id。
- `sourceType`：`github` 或 `personal`。
- `sourceLabel`：用于展示和日志的更新源名称。
- `sourceLatencyMs`：该更新源探测耗时。
- `smartSources`：仅智能模式返回，包含每个更新源的延迟、是否有更新、最新版本、是否有安装资产和错误信息。

`update:download` 只接收资产 URL，主进程按 URL 解析鉴权头，renderer 不需要额外传 source id。

`update:install` 支持 `.exe`、`.zip` 和 `.7z`。本地手动安装调用必须传 `manual=true`，以便安装器用交互模式拉起。
