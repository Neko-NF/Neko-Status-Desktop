# SRS 直播推流功能 — 后端实现方案

> **文档角色**：开发经理 → 后端开发负责人  
> **版本**：v1.0 | **创建日期**：2026-04-06  
> **阅读对象**：负责 Neko 后端服务（Node.js / Python FastAPI）的开发人员  
> **前置依赖**：《SRS直播推流-产品需求与功能规划.md》、《02_REST_API接口文档.md》

---

## 一、任务总览

你负责实现以下内容：

1. **Stream Key 管理 API**（生成、查询、重置）
2. **SRS 连通性代理测试接口**（供客户端测试连接用）
3. **推流状态查询接口**（代理转发 SRS HTTP API，隔离客户端直连 SRS 的网络要求）
4. **SRS `on_publish` / `on_unpublish` 回调接收**（v1.2.0 可选提前实现）
5. **Electron 主进程侧业务逻辑**（`api-service.js` / 新增 `stream-service.js`）
6. **OBS WebSocket 集成模块**（主进程实现，可选依赖 `obs-websocket-js`）

---

## 二、新增后端 API 接口

### 统一前缀：`/api/v1/stream`

所有接口须携带 `X-API-Key` 请求头（沿用现有鉴权体系，见《06\_认证与设备管理.md》）。

---

### 2.1 获取/初始化 Stream Key

```
GET /api/v1/stream/key
```

**说明**：首次调用时，服务端自动为该设备生成唯一 Stream Key 并持久化；后续调用返回已有 Key。

**Response 200**

```json
{
  "ok": true,
  "data": {
    "stream_key": "nk_dev_abc123_f3e2d1c0",
    "created_at": "2026-04-01T08:00:00Z"
  }
}
```

---

### 2.2 重置 Stream Key

```
POST /api/v1/stream/key/reset
```

**说明**：使旧 Key 立即失效，生成并返回新 Key。

**Response 200**

```json
{
  "ok": true,
  "data": {
    "stream_key": "nk_dev_abc123_9a8b7c6d"
  }
}
```

---

### 2.3 推流状态查询（代理 SRS HTTP API）

```
GET /api/v1/stream/status
```

**说明**：后端代理请求 SRS 的 `GET http://{srsHost}:{srsApiPort}/api/v1/streams`，解析并返回当前推流状态。此接口隔离客户端直连 SRS 的需求（客户端在内网，SRS 可能部署于服务器侧）。

**Query 参数**

| 参数           | 类型   | 是否必须 | 说明                         |
| -------------- | ------ | -------- | ---------------------------- |
| `srs_host`     | string | ✅       | SRS 服务器地址               |
| `srs_api_port` | number | 否       | SRS HTTP API 端口，默认 1985 |
| `stream_key`   | string | ✅       | 当前设备的 Stream Key        |

**Response 200**

```json
{
  "ok": true,
  "data": {
    "status": "live",
    "viewers": 3,
    "bitrate_kbps": 2500,
    "duration_seconds": 1240
  }
}
```

```json
{
  "ok": true,
  "data": {
    "status": "idle"
  }
}
```

---

### 2.4 SRS 连通性测试（代理测试）

```
POST /api/v1/stream/test-srs
```

**Request Body**

```json
{
  "srs_host": "192.168.1.100",
  "srs_rtmp_port": 1935,
  "srs_api_port": 1985
}
```

**说明**：

1. 向 `http://{srs_host}:{srs_api_port}/api/v1/versions` 发起 GET 请求，测试 SRS HTTP API 可达性
2. 向 `{srs_host}:{srs_rtmp_port}` 发起 TCP TCP握手，验证 RTMP 端口可用

**Response 200（成功）**

```json
{
  "ok": true,
  "data": {
    "srs_version": "5.0.200",
    "rtmp_reachable": true,
    "api_reachable": true
  }
}
```

**Response 200（失败，保持 ok:true，通过内部字段表示）**

```json
{
  "ok": true,
  "data": {
    "rtmp_reachable": false,
    "api_reachable": false,
    "reason": "RTMP 端口不可达，请检查服务器防火墙设置"
  }
}
```

---

### 2.5 SRS on_publish 回调（v1.2.0，提前占位）

```
POST /api/v1/stream/on-publish
```

**说明**：在 SRS 配置文件中 `on_publish` 指向此 URL，SRS 推流开始时主动通知。

**Request Body（SRS 标准回调格式）**

```json
{
  "action": "on_publish",
  "client_id": "xxx",
  "ip": "1.2.3.4",
  "vhost": "__defaultVhost__",
  "app": "live",
  "stream": "nk_dev_abc123_f3e2d1c0",
  "param": ""
}
```

**Response 200**（SRS 要求返回 `0` 表示允许推流）

```json
{ "code": 0 }
```

后端收到回调后，匹配 `stream` 字段与 DB 中的 `stream_key`，记录推流开始时间。

---

## 三、数据库设计

在现有数据库基础上，新增以下表（SQLite / PostgreSQL 均适用）：

### 3.1 `device_stream_keys` 表

```sql
CREATE TABLE device_stream_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT    NOT NULL UNIQUE,  -- 关联 devices 表
  stream_key  TEXT    NOT NULL UNIQUE,  -- nk_dev_xxx_xxxxxxxx
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  reset_at    DATETIME
);
```

### 3.2 `stream_sessions` 表（v1.2.0 可选，提前建表不影响 v1.1.0）

```sql
CREATE TABLE stream_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT    NOT NULL,
  stream_key    TEXT    NOT NULL,
  started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at      DATETIME,
  duration_sec  INTEGER,   -- 结束时计算并写入
  peak_viewers  INTEGER DEFAULT 0
);
```

---

## 四、Stream Key 生成规则

```javascript
// Node.js 实现示例（server 侧）
const crypto = require("crypto");

function generateStreamKey(deviceId) {
  // 格式：nk_{deviceId前8位}_{8位随机hex}
  const prefix = deviceId.replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
  const rand = crypto.randomBytes(4).toString("hex");
  return `nk_${prefix}_${rand}`;
}
```

**安全要求**：

- 使用 `crypto.randomBytes`（密码学安全随机数），禁止使用 `Math.random()`
- Stream Key 不得出现在任何服务端日志的明文中（日志中掩码处理：`nk_dev_abc1_****`）

---

## 五、Electron 主进程实现（`stream-service.js`）

在 `src/main/` 下新建 `stream-service.js`，主进程通过此模块与后端 API 及 OBS WebSocket 通信。

### 5.1 模块职责

```
stream-service.js
  ├── getOrInitStreamKey()        ← 调用后端 GET /api/v1/stream/key
  ├── resetStreamKey()            ← 调用后端 POST /api/v1/stream/key/reset
  ├── getStreamLiveStatus()       ← 调用后端 GET /api/v1/stream/status
  ├── testSrsConnection(config)   ← 调用后端 POST /api/v1/stream/test-srs
  ├── testObsWebSocket(wsConfig)  ← 直接连接 OBS WebSocket（本地 127.0.0.1）
  ├── applyStreamConfigToObs(cfg) ← 通过 OBS WebSocket 写入推流配置
  └── exportObsServiceConfig()    ← 生成并写入 obs-service.json 到桌面
```

### 5.2 OBS WebSocket 集成

#### 依赖安装

```bash
npm install obs-websocket-js
```

> `obs-websocket-js` v5.x 支持 OBS WebSocket 5.x 协议（OBS 28+，当前主流版本）。

#### 核心实现示例

```javascript
// src/main/stream-service.js
const { OBSWebSocket } = require("obs-websocket-js");

const obs = new OBSWebSocket();
let obsConnected = false;

/**
 * 测试 OBS WebSocket 连接
 */
async function testObsWebSocket({
  host = "127.0.0.1",
  port = 4455,
  password = "",
}) {
  try {
    await obs.connect(`ws://${host}:${port}`, password || undefined);
    const version = await obs.call("GetVersion");
    obsConnected = true;
    return { connected: true, obsVersion: version.obsVersion };
  } catch (err) {
    obsConnected = false;
    return { connected: false, reason: err.message };
  }
}

/**
 * 向 OBS 写入推流配置（RTMP URL + Stream Key）
 * OBS WebSocket 5.x 接口：SetStreamServiceSettings
 */
async function applyStreamConfigToObs({ rtmpServer, streamKey }) {
  if (!obsConnected) {
    return { ok: false, error: "请先测试并确认 OBS WebSocket 连接" };
  }
  try {
    await obs.call("SetStreamServiceSettings", {
      streamServiceType: "rtmp_custom",
      streamServiceSettings: {
        server: rtmpServer, // 例：rtmp://192.168.1.100:1935/live
        key: streamKey, // Stream Key
        use_auth: false,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { testObsWebSocket, applyStreamConfigToObs /* ...其他方法 */ };
```

> **注意**：`rtmpServer` 与 `streamKey` **分开传入** OBS（OBS 5.x `SetStreamServiceSettings` 要求分离格式）。
> 即：`server = "rtmp://host:1935/live"`，`key = "nk_dev_xxx_xxxx"`，OBS 内部会拼合为完整推流地址。

### 5.3 OBS 服务配置文件导出（兜底方案）

```javascript
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/**
 * 生成并导出 OBS 服务配置文件
 * 文件放置于用户桌面，文件名：neko-obs-stream-config.json
 */
function exportObsServiceConfig({ rtmpServer, streamKey }) {
  // OBS 服务配置文件格式（OBS 28+ basic.ini 对应的 JSON 导出格式）
  const config = {
    settings: {
      server: rtmpServer,
      key: streamKey,
      use_auth: false,
    },
    type: "rtmp_custom",
  };
  const desktop = path.join(
    app.getPath("desktop"),
    "neko-obs-stream-config.json",
  );
  fs.writeFileSync(desktop, JSON.stringify(config, null, 2), "utf-8");
  return desktop;
}
```

> **注意**：OBS 本身通过「设置 → 推流 → 服务 → 使用流配置文件」导入此 JSON，需在 UI 文档中向用户说明操作步骤。

### 5.4 IPC Handler 注册（`main.js` 中添加）

```javascript
// 在 main.js 的 IPC 注册区新增以下处理器
const streamService = require("./stream-service");

ipcMain.handle("stream:getConfig", () => configStore.get("streamConfig"));
ipcMain.handle("stream:saveConfig", (_, c) => {
  configStore.set("streamConfig", c);
  return { ok: true };
});
ipcMain.handle("stream:getKey", () => streamService.getOrInitStreamKey());
ipcMain.handle("stream:resetKey", () => streamService.resetStreamKey());
ipcMain.handle("stream:getLiveStatus", () =>
  streamService.getStreamLiveStatus(),
);
ipcMain.handle("stream:testSrs", (_, c) => streamService.testSrsConnection(c));
ipcMain.handle("stream:testObsWs", (_, c) => streamService.testObsWebSocket(c));
ipcMain.handle("stream:applyToObs", (_, c) =>
  streamService.applyStreamConfigToObs(c),
);
ipcMain.handle("stream:exportConfig", () =>
  streamService
    .exportObsServiceConfig
    /* 从 configStore 读取拼合后的参数 */
    (),
);
```

### 5.5 `ipc-bridge.js` 扩展（渲染进程桥接层）

```javascript
// 在 ipc-bridge.js 的 nekoIPC 对象中补充
stream: {
  getConfig:          () => ipcRenderer.invoke('stream:getConfig'),
  saveConfig:    (cfg) => ipcRenderer.invoke('stream:saveConfig', cfg),
  getKey:             () => ipcRenderer.invoke('stream:getKey'),
  resetKey:           () => ipcRenderer.invoke('stream:resetKey'),
  getLiveStatus:      () => ipcRenderer.invoke('stream:getLiveStatus'),
  testSrs:       (cfg) => ipcRenderer.invoke('stream:testSrs', cfg),
  testObsWs:     (cfg) => ipcRenderer.invoke('stream:testObsWs', cfg),
  applyToObs:    (cfg) => ipcRenderer.invoke('stream:applyToObs', cfg),
  exportConfig:       () => ipcRenderer.invoke('stream:exportConfig'),
},
```

> 前端 `app-ipc.js` 将上述挂载为 `window.nekoIPC.getStreamConfig()`、`window.nekoIPC.resetStreamKey()` 等（与前端文档约定接口名一一对应）。

---

## 六、`ConfigStore` 新增配置字段

在 `config-store.js` 的默认配置对象中添加：

```javascript
streamConfig: {
  srsHost:      '',
  srsRtmpPort:  1935,
  srsApp:       'live',
  srsApiPort:   1985,
  streamKey:    '',     // 从服务端获取后缓存
  obsWsHost:    '127.0.0.1',
  obsWsPort:    4455,
  obsWsPassword:'',
}
```

---

## 七、推流状态轮询逻辑

```javascript
// stream-service.js
async function getStreamLiveStatus() {
  const config = configStore.get("streamConfig");
  if (!config.srsHost || !config.streamKey) return "idle";

  try {
    // 调用后端代理接口（非直连 SRS，保持架构一致性）
    const resp = await apiService.get("/api/v1/stream/status", {
      srs_host: config.srsHost,
      srs_api_port: config.srsApiPort,
      stream_key: config.streamKey,
    });
    return resp.data.status; // 'live' | 'idle'
  } catch {
    return "error";
  }
}
```

**注意**：status 轮询由**渲染进程 JS 定时器**（10s 间隔）发起 IPC 调用，不在主进程设置独立定时器（避免与 `StatusService` 定时器叠加）。

---

## 八、SRS 服务器端配置参考（附录，告知用户）

用户自托管 SRS 时，需在 SRS 配置文件 `srs.conf` 中启用 HTTP API 及（可选）回调：

```nginx
# srs.conf 关键配置片段
listen              1935;
http_api {
  enabled         on;
  listen          1985;
}
http_server {
  enabled         on;
  listen          8080;
}
vhost __defaultVhost__ {
  # （v1.2.0）推流回调：推流开始时通知 Neko 后端
  # on_publish http://your-neko-backend/api/v1/stream/on-publish;
  # on_unpublish http://your-neko-backend/api/v1/stream/on-publish;
}
```

---

## 九、安全要求清单

| 项目               | 要求                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| Stream Key 随机性  | 使用 `crypto.randomBytes()`，严禁 `Math.random()`                         |
| 日志脱敏           | 所有含 `stream_key` 的日志行须掩码前6位后的部分，如 `nk_dev_*`            |
| OBS WebSocket 密码 | 密码通过 Electron `safeStorage` 加密存储，不得以明文写入 `config.json`    |
| RTMP 传输安全      | 生产环境推荐使用 RTMPS（端口 443），软件提示用户可选填 `rtmps://` 前缀    |
| SRS 回调鉴权       | `on_publish` 回调 URL 追加 `?secret=xxx` 参数，后端验证，防止伪造推流通知 |
| 并发重置保护       | Key 重置接口加频率限制（每设备每分钟最多 3 次），防止枚举攻击             |

---

## 十、验收标准

- [ ] `GET /api/v1/stream/key` 返回正确 Stream Key，重复调用返回同一个 Key
- [ ] `POST /api/v1/stream/key/reset` 生成新 Key，旧 Key 在后续 status 查询中无法匹配
- [ ] `POST /api/v1/stream/test-srs` 正确测试 RTMP TCP 可达 + SRS HTTP API 可达
- [ ] `GET /api/v1/stream/status` 正确代理 SRS HTTP API 返回在线/离线状态
- [ ] OBS WebSocket 连接成功后可写入推流配置，OBS 推流地址自动更新
- [ ] 导出的 `neko-obs-stream-config.json` 格式正确，可在 OBS 中成功导入
- [ ] `ConfigStore` 新增字段有默认值，不影响旧版用户配置迁移
- [ ] 所有 IPC Handler 命名与前端 `ipc-bridge.js` 约定一致

---

_文档责任人：开发经理 | 下发对象：后端 + Electron 主进程开发人员_
