# 02 — REST API 接口文档

> Base URL：`https://api.koirin.com/neko`（生产）/ `http://localhost:8080`（本地测试）  
> 所有接口除特别说明外，均需在请求头携带 `X-API-Key`。

---

## 全局约定

### 请求头

```http
Content-Type: application/json
X-API-Key: nk_stat_xxxxxxxxxxxxxxxx
X-Device-ID: Device-Win-1094
```

### 统一响应格式

```jsonc
// 成功
{
  "ok": true,
  "data": { ... }
}

// 失败
{
  "ok": false,
  "error": {
    "code": "INVALID_API_KEY",   // 机器可读错误码
    "message": "API Key 无效或已过期"
  }
}
```

### 常见错误码

| HTTP | code                | 含义                 |
| ---- | ------------------- | -------------------- |
| 400  | `BAD_REQUEST`       | 参数缺失或格式错误   |
| 401  | `UNAUTHORIZED`      | 未提供或无效 API Key |
| 403  | `FORBIDDEN`         | 无权限操作           |
| 404  | `NOT_FOUND`         | 资源不存在           |
| 413  | `PAYLOAD_TOO_LARGE` | 上传文件超出限制     |
| 429  | `RATE_LIMITED`      | 请求频率超限         |
| 500  | `INTERNAL_ERROR`    | 服务器内部错误       |

---

## 一、认证模块

### 1.1 设备注册 / 获取 API Key

> 首次运行时由客户端调用，服务端生成并返回 API Key。

```
POST /api/v1/auth/register
```

**Request Body**

```json
{
  "device_name": "Device-Win-1094",
  "platform": "win32",
  "hostname": "DESKTOP-ABC123",
  "mac_hash": "sha256(MAC地址)",
  "client_version": "1.0.0"
}
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "device_id": "dev_abc123xyz",
    "api_key": "nk_stat_xxxxxxxxxxxxxxxxxxxx",
    "expires_at": null
  }
}
```

> ⚠️ `api_key` 只在注册时返回一次，客户端须立即持久化到本地（`localStorage` / Electron `safeStorage`）。

---

### 1.2 连接测试（保存配置时调用）

```
GET /api/v1/auth/ping
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "server_time": "2026-03-08T10:42:00Z",
    "device_id": "dev_abc123xyz",
    "server_version": "1.0.0"
  }
}
```

---

## 二、设备状态上报

### 2.1 上报设备状态（主要上报接口）

> 客户端定时调用（默认间隔由用户设置，建议 30s~5min）。

```
POST /api/v1/status
```

**Request Body**

```json
{
  "timestamp": "2026-03-08T10:42:15Z",
  "cpu": {
    "usage_percent": 12.4,
    "temperature_celsius": 45,
    "frequency_ghz": 3.2,
    "core_count": 8
  },
  "memory": {
    "used_mb": 8192,
    "total_mb": 16384,
    "usage_percent": 50.0
  },
  "battery": {
    "level_percent": 85,
    "is_charging": true,
    "power_source": "AC"
  },
  "active_app": {
    "name": "Visual Studio Code",
    "process": "Code.exe",
    "window_title": "app.js — Neko Status"
  },
  "network": {
    "upload_kbps": 120,
    "download_kbps": 350,
    "latency_ms": 12
  },
  "storage": {
    "used_gb": 384,
    "total_gb": 2048
  }
}
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "received_at": "2026-03-08T10:42:16Z",
    "next_report_interval_s": 60
  }
}
```

> `next_report_interval_s`：服务器可动态调整客户端上报间隔，客户端按此值更新定时器。

---

### 2.2 查询当前设备状态

```
GET /api/v1/status/latest
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "timestamp": "2026-03-08T10:42:15Z",
    "cpu_usage": 12.4,
    "memory_usage": 50.0,
    "battery_level": 85,
    "active_app": "Visual Studio Code",
    "is_online": true
  }
}
```

---

### 2.3 查询历史状态记录

```
GET /api/v1/status/history?limit=50&offset=0&from=2026-03-07T00:00:00Z
```

**Query Params**

| 参数     | 类型    | 必填 | 说明                        |
| -------- | ------- | ---- | --------------------------- |
| `limit`  | int     | 否   | 返回条数，默认 50，最大 200 |
| `offset` | int     | 否   | 分页偏移                    |
| `from`   | ISO8601 | 否   | 起始时间                    |
| `to`     | ISO8601 | 否   | 结束时间                    |

**Response 200**

```json
{
  "ok": true,
  "data": {
    "total": 1440,
    "items": [
      {
        "timestamp": "2026-03-08T10:42:15Z",
        "cpu_usage": 12.4,
        "memory_usage": 50.0,
        "battery_level": 85
      }
    ]
  }
}
```

---

## 三、截图上传

### 3.1 上传截图

```
POST /api/v1/screenshot
Content-Type: multipart/form-data
```

**Form Fields**

| 字段            | 类型   | 必填 | 说明                            |
| --------------- | ------ | ---- | ------------------------------- |
| `file`          | File   | 是   | 截图文件（PNG/JPEG，最大 10MB） |
| `captured_at`   | string | 是   | ISO 8601 时间戳                 |
| `monitor_index` | int    | 否   | 显示器序号，默认 1              |
| `resolution`    | string | 否   | 如 `1920x1080`                  |
| `active_app`    | string | 否   | 捕获时的前台应用名              |

**Response 200**

```json
{
  "ok": true,
  "data": {
    "screenshot_id": "ss_20260308_104215_001",
    "url": "https://api.koirin.com/neko/files/screenshots/ss_20260308_104215_001.png",
    "thumbnail_url": "https://api.koirin.com/neko/files/thumbs/ss_20260308_104215_001.jpg",
    "size_bytes": 524288
  }
}
```

---

### 3.2 查询截图列表

```
GET /api/v1/screenshots?limit=20&offset=0
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "total": 256,
    "items": [
      {
        "screenshot_id": "ss_20260308_104215_001",
        "captured_at": "2026-03-08T10:42:15Z",
        "thumbnail_url": "...",
        "resolution": "1920x1080",
        "active_app": "Visual Studio Code",
        "size_bytes": 524288
      }
    ]
  }
}
```

---

### 3.3 删除截图

```
DELETE /api/v1/screenshots/:screenshot_id
```

**Response 200**

```json
{ "ok": true }
```

---

## 四、更新接口（完整定义见 05 文档）

### 4.1 检查更新

```
GET /api/v1/update/check?version=1.0.0&channel=stable
```

**Response 200 — 无更新**

```json
{
  "ok": true,
  "data": {
    "has_update": false,
    "current_version": "1.0.0",
    "latest_version": "1.0.0",
    "channel": "stable"
  }
}
```

**Response 200 — 有更新**

```json
{
  "ok": true,
  "data": {
    "has_update": true,
    "current_version": "1.0.0",
    "latest_version": "1.1.0",
    "channel": "stable",
    "release_date": "2026-03-08",
    "download_url": "https://github.com/your-org/neko-status/releases/download/v1.1.0/NekoStatus-Setup-1.1.0.exe",
    "checksum_sha256": "abc123...",
    "file_size_bytes": 52428800,
    "changelog": "## v1.1.0\n- 新增真实数据接入\n- 修复内存泄漏"
  }
}
```

---

### 4.2 完整性检查

```
POST /api/v1/update/integrity
```

**Request Body**

```json
{
  "installed_version": "1.0.0",
  "file_checksums": {
    "app.js": "sha256_hash_here",
    "main.js": "sha256_hash_here"
  }
}
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "is_valid": true,
    "corrupted_files": []
  }
}
```

---

## 五、服务器下发配置（可选，P2）

```
GET /api/v1/config/remote
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "report_interval_s": 60,
    "screenshot_enabled": true,
    "max_local_screenshots": 100,
    "alert_cpu_threshold": 90,
    "alert_memory_threshold": 85
  }
}
```

---

## 六、速率限制说明

| 接口类型 | 限制             |
| -------- | ---------------- |
| 状态上报 | 60 次/分钟/设备  |
| 截图上传 | 10 次/分钟/设备  |
| 更新检查 | 10 次/小时/设备  |
| 其他接口 | 120 次/分钟/设备 |

超限返回 `429 Too Many Requests`，响应头包含 `Retry-After: <秒数>`。
