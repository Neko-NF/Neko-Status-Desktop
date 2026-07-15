# 06 — Agent 本地 IPC 与安全协议

## 本地 IPC

客户端与 Agent 使用当前用户专属命名管道：

```text
\\.\pipe\NekoStatusPresenceAgent-v1
```

开发构建使用带 `-dev` 后缀的独立命名管道、互斥锁和配置目录，不能读取或覆盖正式版 Agent 凭据。

协议：

- 长度前缀 JSON 帧。
- 单帧最大 64KiB。
- 每个请求包含 `protocolVersion`。
- 管道 ACL 限定当前 Windows SID。
- Electron 与 Agent 维护独立版本号和协议版本；客户端声明支持的 Agent 最低/最高协议版本。

## 命令

| 命令 | 方向 | 说明 |
| --- | --- | --- |
| `hello` | Client → Agent | 握手，返回版本和协议 |
| `get_status` | Client → Agent | 查询状态、PID、内存、连接、心跳 |
| `provision` | Client → Agent | 下发一次性 Agent Token 和配置 |
| `reload_config` | Client → Agent | 重载非敏感配置 |
| `claim_tray` | Client → Agent | 客户端接管托盘 |
| `release_tray` | Client → Agent | 客户端释放托盘 |
| `pause` | Client → Agent | 临时暂停 |
| `resume` | Client → Agent | 恢复 |
| `refresh_bootstrap` | Client → Agent | 重新拉取规则摘要 |
| `shutdown(reason)` | Client → Agent | 按原因退出；`disable/logout/account_change/credential_invalid/server_change` 同时撤销本地身份 |

协议 v1 是严格的请求—响应协议，不发送未经请求的 `activity_event` 或 `connection_changed` 帧。Electron 在 Activity 页面可见时通过轻量 `get_status` 轮询状态；业务事件由 Agent 直接处理通知和游标。若未来加入推送，必须先升级带 `kind`、`requestId` 和能力协商的协议，不能让事件帧占用普通命令响应。

显式登出、切换账号/服务器或凭据失效时，Agent 必须在回复成功前原子清除 Token、游标、去重记录、用户/设备绑定和私有快照缓存。若 pipe 无法连接，Electron 释放 socket 后调用同通道的 `--clear-activity-identity` 离线清理器；清理器持有对应正式版或开发版互斥锁，避免与新 Agent 启动并发写 profile。

## `get_status` 健康快照

返回值使用加法兼容的 v2 健康快照，分别表达：

- `lifecycle`：进程和 embedded/background/paused 运行方式。
- `localIpc`：本地 pipe 状态，由 Electron 补充。
- `provision`：凭据和当前账号绑定。
- `receiver`：SSE/轮询接收链路及最近心跳、事件、重试时间。
- `publisher`：Presence 发布链路及最近成功时间。

旧 `state` / `connection` 只保留为派生兼容字段。Presence 和事件接收线程不得写同一个连接字段。

## Provision 流程

Electron 不直接生成代理可解密的密文。

1. 客户端通过用户 JWT 调用 `POST /api/activity/agent/enroll`。
2. 服务端返回一次性明文 Agent Token。
3. 客户端通过命名管道发送 `provision`。
4. Agent 使用 Windows DPAPI 当前用户范围加密并原子写入。
5. IPC 响应、renderer 和日志永不返回 Token。

## 本地配置

非敏感配置：

- 服务器地址。
- 功能开关。
- 通知设置。
- 活动快照开关、尺寸/大小上限、缓存目录和截图隐私规则。
- 后台模式。
- 登录启动设置。
- 协议版本。

DPAPI 加密配置：

- Agent Token。
- 设备与账号绑定信息。
- 事件游标。

写入要求：

- 敏感配置使用 DPAPI 用户范围。
- 配置写入使用临时文件 + 原子替换。
- 损坏时进入可修复状态，不输出 Token。

## 日志安全

禁止日志输出：

- Agent Token 明文。
- DPAPI 密文。
- 用户 JWT。
- 原始窗口标题。
- 原始输入节奏。
- 鼠标轨迹。
- 活动快照原始字节和通知图片完整 URL。

允许日志输出：

- Agent 版本。
- 协议版本。
- 状态枚举。
- 连接状态。
- 退避阶段。
- Token 安全前缀。
- 低粒度 detectorKind。

## 协议兼容

客户端启动时检查：

- Agent 可执行文件存在。
- Agent 协议版本在客户端支持范围内。
- 命名管道握手成功。

不兼容时：

- 页面显示“需要修复/重新配置代理”。
- 不启动第二套检测。
- 不把错误静默吞掉为成功。

## 安全边界

Agent Token 只允许：

- `presence:write`
- `events:read`
- `bootstrap:read`
- `snapshot:write`

`events:read` 读取快照时仍需通过“该用户确实收到绑定快照的事件”校验。用户级管理操作必须使用用户 JWT/Cookie 并在客户端内完成。Agent 即使被本机低权限进程调用，也不应该具备修改关注关系、隐私或拉黑的能力。
