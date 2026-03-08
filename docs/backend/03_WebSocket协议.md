# 03 — WebSocket 协议文档

> WebSocket 端点：`wss://api.koirin.com/neko/ws`（生产）/ `ws://localhost:8080/neko/ws`（本地）

---

## 连接建立

### 握手 URL

```
wss://api.koirin.com/neko/ws?device_id=dev_abc123xyz&api_key=nk_stat_xxxx
```

| Query 参数       | 必填 | 说明                                       |
| ---------------- | ---- | ------------------------------------------ |
| `device_id`      | 是   | 设备唯一标识（注册时获取）                 |
| `api_key`        | 是   | API Key（与 REST 接口相同）                |
| `client_version` | 否   | 客户端版本，用于服务端判断是否推送强制更新 |

### 服务端鉴权

1. 服务端验证 `api_key` 有效性
2. 验证失败 → 关闭连接，关闭码 `4001`（Unauthorized）
3. 验证成功 → 发送 `connected` 消息

---

## 消息格式

所有消息均为 **JSON 字符串**，统一包含 `type` 字段：

```jsonc
// 发送方向：服务端 → 客户端 (S2C) 或 客户端 → 服务端 (C2S)
{
  "type": "消息类型",
  "timestamp": "2026-03-08T10:42:00Z",   // ISO 8601，发送方时间
  "payload": { ... }                       // 消息体，各类型不同
}
```

---

## 消息类型一览

| type                | 方向 | 说明                         |
| ------------------- | ---- | ---------------------------- |
| `connected`         | S2C  | 连接建立成功确认             |
| `ping`              | C2S  | 心跳探测                     |
| `pong`              | S2C  | 心跳回应                     |
| `status_report`     | C2S  | 客户端主动推送实时状态       |
| `status_ack`        | S2C  | 服务端确认收到状态           |
| `screenshot_notify` | C2S  | 通知服务端截图已就绪（可选） |
| `config_push`       | S2C  | 服务端下推配置变更           |
| `update_available`  | S2C  | 服务端主动推送有新版本       |
| `force_update`      | S2C  | 服务端推送强制更新通知       |
| `disconnect`        | 双向 | 主动断开通知                 |

---

## 各消息详细格式

### connected（S2C）

```json
{
  "type": "connected",
  "timestamp": "2026-03-08T10:42:00Z",
  "payload": {
    "session_id": "sess_abc123",
    "server_version": "1.0.0",
    "heartbeat_interval_s": 30,
    "message": "欢迎连接 Neko Status 服务器"
  }
}
```

> 客户端收到此消息后，按 `heartbeat_interval_s` 设置心跳定时器。

---

### ping（C2S）

```json
{
  "type": "ping",
  "timestamp": "2026-03-08T10:42:30Z",
  "payload": {
    "client_time_ms": 1741430550000
  }
}
```

### pong（S2C）

```json
{
  "type": "pong",
  "timestamp": "2026-03-08T10:42:30Z",
  "payload": {
    "client_time_ms": 1741430550000,
    "server_time_ms": 1741430550042,
    "latency_ms": 42
  }
}
```

> 服务端若 90 秒内未收到 ping，主动关闭连接（关闭码 `1001`）。

---

### status_report（C2S）

> 客户端可选择通过 WebSocket 直接推状态（替代 REST POST /api/v1/status），适合高频场景。

```json
{
  "type": "status_report",
  "timestamp": "2026-03-08T10:42:15Z",
  "payload": {
    "cpu_usage": 12.4,
    "memory_usage": 50.0,
    "battery_level": 85,
    "is_charging": true,
    "active_app": "Visual Studio Code",
    "active_process": "Code.exe"
  }
}
```

### status_ack（S2C）

```json
{
  "type": "status_ack",
  "timestamp": "2026-03-08T10:42:16Z",
  "payload": {
    "received": true
  }
}
```

---

### config_push（S2C）

> 服务端在配置变更时主动下发，客户端收到后更新本地配置并按需重启定时任务。

```json
{
  "type": "config_push",
  "timestamp": "2026-03-08T10:45:00Z",
  "payload": {
    "report_interval_s": 30,
    "screenshot_enabled": false,
    "alert_cpu_threshold": 80
  }
}
```

---

### update_available（S2C）

> 服务端在后台检测到新版本时主动推送，客户端在 UI 上展示提示。

```json
{
  "type": "update_available",
  "timestamp": "2026-03-08T11:00:00Z",
  "payload": {
    "latest_version": "1.1.0",
    "current_version": "1.0.0",
    "channel": "stable",
    "changelog_summary": "新增实时数据接入，修复若干 Bug",
    "release_url": "https://github.com/your-org/neko-status/releases/tag/v1.1.0"
  }
}
```

---

### force_update（S2C）

> 当服务端判断当前版本存在严重安全漏洞或不兼容时，发送强制更新消息。客户端需弹出强制更新弹窗，不可关闭。

```json
{
  "type": "force_update",
  "timestamp": "2026-03-08T11:00:00Z",
  "payload": {
    "target_version": "1.1.1",
    "reason": "当前版本存在严重安全漏洞，必须立即更新",
    "download_url": "https://...",
    "deadline_minutes": 10
  }
}
```

---

### disconnect（双向）

```json
{
  "type": "disconnect",
  "timestamp": "2026-03-08T10:50:00Z",
  "payload": {
    "reason": "user_logout"
  }
}
```

**reason 枚举：**

| reason               | 发起方 | 含义           |
| -------------------- | ------ | -------------- |
| `user_logout`        | C2S    | 用户主动退出   |
| `api_key_revoked`    | S2C    | API Key 被吊销 |
| `server_maintenance` | S2C    | 服务器维护     |
| `idle_timeout`       | S2C    | 连接超时空闲   |

---

## 关闭码

| 代码   | 含义                     |
| ------ | ------------------------ |
| `1000` | 正常关闭                 |
| `1001` | 心跳超时                 |
| `4001` | 认证失败（API Key 无效） |
| `4003` | 被禁止（设备已封禁）     |
| `4004` | 设备 ID 不存在           |
| `4429` | 连接频率超限             |

---

## 重连策略（客户端实现参考）

```javascript
// 指数退避 + 最大重连次数
const RECONNECT_INTERVALS = [1000, 2000, 5000, 10000, 30000]; // ms
let reconnectAttempt = 0;

function reconnect() {
  if (reconnectAttempt >= RECONNECT_INTERVALS.length) {
    showError("无法连接到服务器，请检查网络或服务器地址");
    return;
  }
  const delay = RECONNECT_INTERVALS[reconnectAttempt++];
  setTimeout(() => {
    initWebSocket();
  }, delay);
}

ws.onclose = (event) => {
  if (event.code === 4001) return; // 认证失败不重连
  if (event.code === 4003) return; // 被封禁不重连
  reconnect();
};

ws.onopen = () => {
  reconnectAttempt = 0; // 重置计数
};
```

---

## 并发限制

- 同一设备同时只允许 **1 个活跃 WebSocket 连接**
- 若已有连接时再次访问握手 URL，服务端将先关闭旧连接（`4001` 或强制踢下线）再建立新连接，或直接拒绝新连接（返回 `409 Conflict`）
- 推荐采用"踢旧"策略，以支持客户端重启不卡登录
