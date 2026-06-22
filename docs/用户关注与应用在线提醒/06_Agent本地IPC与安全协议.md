# 06 — Agent 本地 IPC 与安全协议

## 本地 IPC

客户端与 Agent 使用当前用户专属命名管道：

```text
\\.\pipe\NekoStatusPresenceAgent-v1
```

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
| `shutdown(session|disable|logout|update)` | Client → Agent | 按原因退出 |
| `activity_event` | Agent → Client | 活动事件同步到 UI |
| `connection_changed` | Agent → Client | 网络状态变化 |

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
