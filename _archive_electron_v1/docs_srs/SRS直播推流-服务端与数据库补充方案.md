# SRS 直播推流功能 — 服务端与数据库补充方案

> **文档角色**：开发经理 → WEB_NF2 服务端（Next.js）+ Neko 后端双端开发人员  
> **版本**：v1.0 | **创建日期**：2026-04-09  
> **阅读对象**：负责 WEB_NF2（Next.js 全栈）与 Neko 后端（api.koirin.com）的开发人员  
> **前置依赖**：《SRS直播推流-产品需求与功能规划.md》、《SRS直播推流-后端实现方案.md》

---

## 一、架构层级说明

本项目存在两个服务端层级，本文档均需覆盖：

```
┌──────────────────────────────────────────────────────────────┐
│  用户浏览器 / Electron 客户端                                  │
└────────────────┬─────────────────────────────────────────────┘
                 │ HTTPS (Cookie Session / DeviceKey)
┌────────────────▼─────────────────────────────────────────────┐
│  WEB_NF2 — Next.js 应用服务器  (nekostatus.koirin.com)        │
│  · 页面渲染 (App Router)                                       │
│  · API Route 层 (/api/stream/*)  ← 本文档 A 部分              │
│  · Prisma ORM → MySQL 数据库    ← 本文档 B 部分               │
└────────────────┬─────────────────────────────────────────────┘
                 │ 内部 HTTP (INTERNAL_SECRET)
┌────────────────▼─────────────────────────────────────────────┐
│  Neko 后端服务  (api.koirin.com)                               │
│  · REST API (/api/v1/stream/*)  ← 本文档 C 部分               │
│  · SRS HTTP API 代理                                           │
│  · Stream Key 权威存储                                         │
└──────────────────────────────────────────────────────────────┘
```

> **职责划分**：Stream Key 的权威存储与下发在 **Neko 后端**；WEB_NF2 作为中间层，通过内部接口 (`INTERNAL_SECRET`) 与 Neko 后端通信，并将必要的 `isLive` / `streamKey` 冗余缓存到 MySQL，供首屏快速渲染使用。

---

## A 部分：WEB_NF2 Next.js API Route 补充实现

### A-1 完整路由清单

| 路由                       | 方法 | 鉴权                       | 说明                                                   |
| -------------------------- | ---- | -------------------------- | ------------------------------------------------------ |
| `/api/stream/live-devices` | GET  | 登录用户                   | 获取当前所有在线直播设备及 HLS 地址                    |
| `/api/stream/key/reset`    | POST | 登录用户（owner 或 admin） | 重置指定设备的 Stream Key                              |
| `/api/stream/status`       | GET  | 登录用户                   | 查询单台设备推流状态                                   |
| `/api/stream/on-publish`   | POST | `INTERNAL_SECRET`          | SRS on_publish 回调中继（由 Neko 后端或 SRS 直接调用） |

---

### A-2 `/api/stream/live-devices` — 在线直播设备列表

**完整实现**（`app/api/stream/live-devices/route.ts`）：

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const BACKEND = process.env.NEKO_BACKEND_URL ?? "http://localhost:8080";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  // 1. 从 MySQL 查找当前标记为直播中的设备（快速缓存读取）
  const liveDevices = await prisma.deviceStreamKey.findMany({
    where: { isLive: true },
    include: {
      device: {
        select: { id: true, name: true, owner: { select: { username: true } } },
      },
    },
  });

  if (liveDevices.length === 0) {
    return NextResponse.json({ ok: true, devices: [] });
  }

  // 2. 向 Neko 后端批量查询实时数据（viewers / bitrate / HLS URL）
  const streamKeys = liveDevices.map((d) => d.streamKey);
  const res = await fetch(`${BACKEND}/api/v1/stream/batch-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.INTERNAL_SECRET ?? "",
    },
    body: JSON.stringify({ streamKeys }),
    next: { revalidate: 0 },
  });
  const backendData = await res.json();

  // 3. 拼合前端所需格式
  const devices = liveDevices
    .map((d) => {
      const stats = backendData.data?.[d.streamKey];
      if (!stats || stats.status !== "live") return null;
      return {
        deviceId: d.deviceId,
        deviceName: d.device.name,
        ownerName: d.device.owner.username,
        streamKey: d.streamKey,
        hlsUrl: `${process.env.SRS_HLS_BASE_URL}/live/${d.streamKey}.m3u8`,
        viewers: stats.viewers ?? 0,
        bitrateKbps: stats.bitrate_kbps ?? 0,
        durationSeconds: stats.duration_seconds ?? 0,
        startedAt: d.liveStartedAt?.toISOString() ?? "",
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, devices });
}
```

**环境变量（补充到 `.env.local`）**：

```bash
# SRS HLS 对外地址（用户浏览器直接拉流，必须公网可达）
SRS_HLS_BASE_URL=http://your-srs-server:8080
```

---

### A-3 `/api/stream/status` — 单设备推流状态查询

```typescript
// app/api/stream/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const BACKEND = process.env.NEKO_BACKEND_URL ?? "http://localhost:8080";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const deviceId = req.nextUrl.searchParams.get("deviceId");
  if (!deviceId)
    return NextResponse.json(
      { ok: false, error: "deviceId 必填" },
      { status: 400 },
    );

  const keyRecord = await prisma.deviceStreamKey.findUnique({
    where: { deviceId: Number(deviceId) },
    select: { streamKey: true, isLive: true },
  });
  if (!keyRecord)
    return NextResponse.json({ ok: true, data: { status: "idle" } });

  // 代理 Neko 后端实时查询
  const res = await fetch(
    `${BACKEND}/api/v1/stream/status?stream_key=${keyRecord.streamKey}`,
    {
      headers: { "X-Internal-Secret": process.env.INTERNAL_SECRET ?? "" },
      next: { revalidate: 0 },
    },
  );
  const data = await res.json();
  return NextResponse.json(data);
}
```

---

### A-4 `/api/stream/on-publish` — SRS 推流事件中继

此接口有两种调用来源：

- **来源 A**：Neko 后端收到 SRS `on_publish` 回调后，再通知 WEB_NF2 更新直播状态缓存
- **来源 B**（备用）：SRS 直接回调此地址（需 SRS 与 WEB_NF2 在同一网络）

```typescript
// app/api/stream/on-publish/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  // 内部密钥鉴权（不使用 Cookie Session）
  const secret = req.headers.get("X-Internal-Secret");
  if (secret !== process.env.INTERNAL_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = await req.json();
  const { streamKey, action } = body;
  // action: 'publish' | 'unpublish'

  if (!streamKey || !action) {
    return NextResponse.json({ ok: false, error: "参数缺失" }, { status: 400 });
  }

  if (action === "publish") {
    await prisma.deviceStreamKey.updateMany({
      where: { streamKey },
      data: { isLive: true, liveStartedAt: new Date() },
    });
  } else if (action === "unpublish") {
    // 计算本次直播时长并写入历史
    const record = await prisma.deviceStreamKey.findFirst({
      where: { streamKey },
      select: { deviceId: true, liveStartedAt: true },
    });
    if (record?.liveStartedAt) {
      const durationSec = Math.floor(
        (Date.now() - record.liveStartedAt.getTime()) / 1000,
      );
      await prisma.streamSession.create({
        data: {
          deviceId: record.deviceId,
          streamKey,
          startedAt: record.liveStartedAt,
          endedAt: new Date(),
          durationSec,
        },
      });
    }
    await prisma.deviceStreamKey.updateMany({
      where: { streamKey },
      data: { isLive: false, liveStartedAt: null },
    });
  }

  return NextResponse.json({ ok: true });
}
```

---

## B 部分：Prisma 数据库 Schema 扩展

### B-1 新增 Model：`DeviceStreamKey`

追加到 `prisma/schema.prisma`（现有 `Device` model 之后）：

```prisma
// ===== SRS 直播推流 =====

model DeviceStreamKey {
  id          Int       @id @default(autoincrement())
  deviceId    Int       @unique                        // 一台设备唯一一条记录
  device      Device    @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  streamKey   String    @unique                        // nk_xxx_xxxxxxxx
  isLive      Boolean   @default(false)                // 当前是否推流中（缓存值）
  liveStartedAt DateTime?                              // 本次推流开始时间

  createdAt   DateTime  @default(now())
  resetAt     DateTime?                                // 最近一次 Key 重置时间

  sessions    StreamSession[]                          // 直播历史

  @@index([streamKey])
  @@index([isLive])
  @@map("device_stream_keys")
}

model StreamSession {
  id          Int       @id @default(autoincrement())
  deviceId    Int
  streamKey   String
  keyRecord   DeviceStreamKey @relation(fields: [streamKey], references: [streamKey])

  startedAt   DateTime
  endedAt     DateTime?
  durationSec Int?                                     // 推流时长（秒）
  peakViewers Int       @default(0)

  createdAt   DateTime  @default(now())

  @@index([deviceId])
  @@index([startedAt])
  @@map("stream_sessions")
}
```

### B-2 Device Model 关联追加

在现有 `Device` model 的 Relations 区域末尾追加：

```prisma
model Device {
  // ...现有字段不变...

  // 追加关联
  streamKey     DeviceStreamKey?               // 直播推流 Key
}
```

### B-3 迁移步骤

```bash
# 在 WEB_NF2/my-app 目录执行
cd "d:\VScode project\WEB_NF2\my-app"

# 生成迁移文件
npx prisma migrate dev --name add_stream_key_and_sessions

# 生产环境部署
npx prisma migrate deploy

# 重新生成 Prisma Client
npx prisma generate
```

### B-4 `/api/devices` 查询扩展

`app/api/devices/route.ts` 的 Prisma `select` 中，追加 `streamKey` 关联查询，并根据角色决定返回内容：

```typescript
// 在现有 prisma.device.findMany 的 select 中追加
select: {
  // ...现有 select 字段不变...
  streamKey: {
    select: {
      streamKey: true,
      isLive:    true,
    }
  }
}

// 在 Response 数据拼合处（map 处），追加字段逻辑：
const isOwnerOrAdmin = isAdmin || device.ownerId === session.userId
return {
  // ...现有字段...
  isLive:    device.streamKey?.isLive    ?? false,
  // streamKey 字段仅返回给 owner 或 admin，普通用户得到 undefined
  ...(isOwnerOrAdmin && { streamKey: device.streamKey?.streamKey ?? null }),
}
```

---

## C 部分：Neko 后端新增接口

> 以下为 Neko 后端（`api.koirin.com`，Node.js / Python）**额外需要新增**的接口，是对《SRS直播推流-后端实现方案.md》的补充，该文档原有接口不重复。

### C-1 批量推流状态查询（供 WEB_NF2 拉取多设备实时数据）

```
POST /api/v1/stream/batch-status
鉴权：X-Internal-Secret（内部服务间通信）
```

**Request Body**

```json
{
  "streamKeys": ["nk_dev_abc1_f3e2d1c0", "nk_dev_xyz2_a1b2c3d4"]
}
```

**Response 200**

```json
{
  "ok": true,
  "data": {
    "nk_dev_abc1_f3e2d1c0": {
      "status": "live",
      "viewers": 12,
      "bitrate_kbps": 2800,
      "duration_seconds": 3610
    },
    "nk_dev_xyz2_a1b2c3d4": {
      "status": "idle"
    }
  }
}
```

**实现说明**：遍历 `streamKeys`，对每个 Key 调用 SRS HTTP API `GET /api/v1/streams`，解析 `stream.name` 匹配后提取实时数据，并发执行以降低延迟。

```javascript
// Node.js 参考实现骨架
async function batchQuerySrsStatus(streamKeys, srsApiBase) {
  const [srsResp] = await Promise.all([
    fetch(`${srsApiBase}/api/v1/streams`).then((r) => r.json()),
  ]);
  const streamMap = {};
  for (const stream of srsResp.streams ?? []) {
    streamMap[stream.name] = stream;
  }
  const result = {};
  for (const key of streamKeys) {
    const s = streamMap[key];
    if (s) {
      result[key] = {
        status: "live",
        viewers: s.clients ?? 0,
        bitrate_kbps: Math.round(s.kbps?.recv_30s ?? 0),
        duration_seconds: Math.round(
          Date.now() / 1000 - s.publish?.cid ? 0 : s.live_ms / 1000,
        ),
      };
    } else {
      result[key] = { status: "idle" };
    }
  }
  return result;
}
```

---

### C-2 on_publish 回调透传（通知 WEB_NF2 更新缓存）

在 Neko 后端的 `on_publish` 处理逻辑中（收到 SRS 回调后），额外向 WEB_NF2 转发通知：

```javascript
// 在现有 on_publish Handler 末尾追加
async function notifyWebApp(streamKey, action) {
  const WEB_URL = process.env.WEB_APP_URL ?? "http://localhost:3000";
  await fetch(`${WEB_URL}/api/stream/on-publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.INTERNAL_SECRET ?? "",
    },
    body: JSON.stringify({ streamKey, action }),
  }).catch((err) =>
    console.warn("[stream] 通知 WebApp 失败（非致命）:", err.message),
  );
  // 注意：通知失败不影响 SRS 的 on_publish 响应，catch 避免阻塞
}
```

**Neko 后端新增环境变量**：

```bash
# WEB_NF2 内网地址（用于回调透传）
WEB_APP_URL=http://localhost:3000
```

---

### C-3 流媒体 Key 查询（供管理员面板直接操作）

```
GET /api/v1/stream/admin/keys
鉴权：X-Internal-Secret 或 X-API-Key（管理员 Key）
```

**Query 参数**：`deviceId`（可选，不传则返回所有设备）

**Response 200**

```json
{
  "ok": true,
  "data": [
    {
      "device_id": "dev_abc123",
      "stream_key": "nk_dev_abc1_f3e2d1c0",
      "is_live": false,
      "created_at": "2026-04-01T08:00:00Z",
      "reset_at": null
    }
  ]
}
```

---

## D 部分：双端环境变量配置总表

### D-1 WEB_NF2（`.env.local`）追加项

| 变量名             | 示例值                   | 说明                                |
| ------------------ | ------------------------ | ----------------------------------- |
| `NEKO_BACKEND_URL` | `http://localhost:8080`  | Neko 后端内网地址                   |
| `INTERNAL_SECRET`  | `change_this_secret_xxx` | 内部服务间通信密钥                  |
| `SRS_HLS_BASE_URL` | `http://your-srs:8080`   | SRS 对外 HLS 地址（用户浏览器可达） |

### D-2 Neko 后端（`.env`）追加项

| 变量名            | 示例值                   | 说明                                |
| ----------------- | ------------------------ | ----------------------------------- |
| `WEB_APP_URL`     | `http://localhost:3000`  | WEB_NF2 内网地址（on_publish 回调） |
| `INTERNAL_SECRET` | `change_this_secret_xxx` | 须与 WEB_NF2 配置相同值             |
| `SRS_API_BASE`    | `http://srs-server:1985` | SRS HTTP API 地址                   |
| `SRS_RTMP_HOST`   | `srs-server`             | SRS RTMP 主机（用于 batch-status）  |

> ⚠️ `INTERNAL_SECRET` 两端必须保持完全一致；生产环境须使用 32 位以上随机字符串，禁止使用示例值。

---

## E 部分：直播历史记录页面（WEB_NF2）

### E-1 新增路由页面（可选，v1.2.0 实现）

`app/stream-history/page.tsx` — 展示设备直播历史记录，管理员可查看所有设备，普通用户只查自己。

**数据接口**：

```typescript
// app/api/stream/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  });
  const isAdmin = currentUser?.role === "admin";

  const sessions = await prisma.streamSession.findMany({
    where: isAdmin
      ? {}
      : {
          keyRecord: { device: { ownerId: session.userId } },
        },
    include: {
      keyRecord: {
        include: { device: { select: { name: true } } },
      },
    },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    ok: true,
    data: sessions.map((s) => ({
      id: s.id,
      deviceName: s.keyRecord.device.name,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSec: s.durationSec,
      peakViewers: s.peakViewers,
    })),
  });
}
```

---

## F 部分：安全核查清单

| 项目                     | 检查点                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **SQL 注入**             | 所有数据库操作均通过 Prisma ORM，无裸 SQL 拼接                                                                                   |
| **越权访问**             | `/api/stream/key/reset` 在 Prisma 查询后二次校验 `ownerId === session.userId` 或 `isAdmin`，不依赖前端传入的角色参数             |
| **内部接口暴露**         | `/api/stream/on-publish` 校验 `X-Internal-Secret`，不校验 Cookie Session，部署时确保此接口不对外公开（nginx 层过滤或 IP 白名单） |
| **Stream Key 脱敏**      | Prisma 返回数据在 API Route 组装时根据角色判断，错误路径不得泄漏其他用户的 Stream Key                                            |
| **HLS 地址认证**         | 当前 HLS 地址通过登录鉴权的 API 返回，SRS 侧建议配置 Token 鉴权（`play.token`），防止直链外泄                                    |
| **INTERNAL_SECRET 长度** | 生产环境使用 `crypto.randomBytes(32).toString('hex')` 生成，定期轮换                                                             |

---

## G 部分：联调验收标准

**WEB_NF2 Next.js 服务端**

- [ ] `npx prisma migrate dev` 无报错，新表 `device_stream_keys` / `stream_sessions` 已创建
- [ ] `GET /api/stream/live-devices` 在无直播时返回 `devices: []`，有直播时包含完整 HLS 地址
- [ ] `POST /api/stream/key/reset` 非 owner/admin 请求返回 `403`
- [ ] `POST /api/stream/on-publish` 缺少或错误 `INTERNAL_SECRET` 返回 `403`
- [ ] `GET /api/devices` 响应中 `isLive` 正确，普通用户不包含 `streamKey`

**Neko 后端**

- [ ] `POST /api/v1/stream/batch-status` 正确代理 SRS HTTP API 并合并结果
- [ ] `on_publish` 回调触发后，WEB_NF2 中 `isLive` 缓存在 2s 内更新为 `true`
- [ ] `on_unpublish` 回调触发后，`stream_sessions` 表有新记录，`durationSec` 计算正确

---

_文档责任人：开发经理 | 下发对象：WEB_NF2 服务端 + Neko 后端开发人员 | 须与《SRS直播推流-网页端UIUX设计规范.md》配套阅读_
