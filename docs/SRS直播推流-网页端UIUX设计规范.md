# SRS 直播推流功能 — 网页端 UI/UX 设计规范

> **文档角色**：开发经理 → WEB_NF2 前端开发人员  
> **版本**：v1.0 | **创建日期**：2026-04-09  
> **阅读对象**：负责 `WEB_NF2/my-app`（Next.js App Router）的前端开发人员  
> **技术栈**：Next.js 14+ · TypeScript · Tailwind CSS · Prisma · Framer Motion · Lucide Icons  
> **前置依赖**：《SRS直播推流-产品需求与功能规划.md》、《SRS直播推流-服务端与数据库补充方案.md》

---

## 一、任务总览

网页端需配套 Electron 客户端的推流功能，完成以下四处改动：

| 任务 | 位置                    | 说明                                                     |
| ---- | ----------------------- | -------------------------------------------------------- |
| T-W1 | `DeviceStatusCard` 组件 | 卡片新增「直播中」徽标与推流状态指示                     |
| T-W2 | `/manage` 页面          | Stream Key 查看 / 重置管理功能                           |
| T-W3 | `/live` 页面            | 接入 SRS HLS 真实推流地址、展示在线直播设备列表          |
| T-W4 | `/api/stream/*` 路由    | Next.js API Route 层（代理后端 stream 接口，供前端调用） |

---

## 二、T-W1：DeviceStatusCard — 推流状态徽标

### 2.1 改动范围

文件：`components/DeviceStatusCard.tsx`

在卡片右上角的状态区域（当前展示 battery + online/offline badge 的区域），追加「直播中」红色脉冲徽标。

### 2.2 数据来源

`DeviceData` 接口中新增两个可选字段（由 `/api/devices` 路由填充，详见服务端文档）：

```typescript
// 追加到现有 DeviceData interface
interface DeviceData {
  // ...现有字段不变...
  isLive?: boolean; // 当前是否正在推流
  streamKey?: string; // Stream Key（仅自己设备或管理员可见，普通用户不返回）
}
```

### 2.3 UI 实现

在现有 battery 徽标之后（JSX 内）插入：

```tsx
{
  /* 直播状态徽标 */
}
{
  device.isLive && (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-red-400 text-xs font-bold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      LIVE
    </span>
  );
}
```

> **约束**：不修改卡片整体布局与尺寸；`isLive` 为 `false` 或 `undefined` 时该片段不渲染。

---

## 三、T-W2：/manage 页面 — Stream Key 管理

### 3.1 改动范围

文件：`app/manage/ManageClient.tsx`

在每台设备的管理行内，已存在 `verification`（设备密钥）的查看/复制功能。**参照相同 UI 模式**，紧邻其后追加 Stream Key 的查看、复制、重置功能。

### 3.2 State 扩展

```typescript
// 追加到 ManageClient 组件 state
const [visibleStreamKeys, setVisibleStreamKeys] = useState<Set<number>>(
  new Set(),
);
const [copiedStreamKey, setCopiedStreamKey] = useState<number | null>(null);
const [resettingKey, setResettingKey] = useState<number | null>(null);

// 设备数据中新增 streamKey 字段（同 DeviceData）
interface Device {
  // ...现有字段...
  streamKey?: string | null;
  isLive?: boolean;
}
```

### 3.3 JSX — Stream Key 行（追加在 verification 行之后）

```tsx
{
  /* Stream Key 行（仅 canManage 用户可见） */
}
{
  canManage(device) && (
    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
      <span className="shrink-0 font-medium text-foreground/60">
        Stream Key:
      </span>

      {/* 密文/明文切换 */}
      <span className="font-mono text-foreground/80 truncate max-w-[160px]">
        {visibleStreamKeys.has(device.id)
          ? (device.streamKey ?? "未生成")
          : "••••••••••••••••"}
      </span>

      {/* 显示/隐藏 */}
      <button
        onClick={() => toggleStreamKeyVisibility(device.id)}
        className="p-0.5 hover:text-foreground transition-colors"
        title={visibleStreamKeys.has(device.id) ? "隐藏" : "显示"}
      >
        {visibleStreamKeys.has(device.id) ? (
          <EyeOff className="w-3.5 h-3.5" />
        ) : (
          <Eye className="w-3.5 h-3.5" />
        )}
      </button>

      {/* 复制 */}
      {device.streamKey && (
        <button
          onClick={() => copyStreamKey(device.id, device.streamKey!)}
          className="p-0.5 hover:text-foreground transition-colors"
          title="复制 Stream Key"
        >
          {copiedStreamKey === device.id ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      {/* 重置（二次确认） */}
      {isAdmin && (
        <button
          onClick={() => handleResetStreamKey(device.id)}
          disabled={resettingKey === device.id}
          className="p-0.5 hover:text-red-400 transition-colors disabled:opacity-40"
          title="重置 Stream Key（旧 Key 立即失效）"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${resettingKey === device.id ? "animate-spin" : ""}`}
          />
        </button>
      )}

      {/* 直播中角标 */}
      {device.isLive && (
        <span className="text-red-400 font-bold animate-pulse">● LIVE</span>
      )}
    </div>
  );
}
```

### 3.4 事件处理函数

```typescript
// 追加到 ManageClient 组件

function toggleStreamKeyVisibility(deviceId: number) {
  setVisibleStreamKeys((prev) => {
    const next = new Set(prev);
    next.has(deviceId) ? next.delete(deviceId) : next.add(deviceId);
    return next;
  });
}

function copyStreamKey(deviceId: number, key: string) {
  navigator.clipboard.writeText(key);
  setCopiedStreamKey(deviceId);
  setTimeout(() => setCopiedStreamKey(null), 2000);
}

async function handleResetStreamKey(deviceId: number) {
  if (
    !confirm(
      "重置后旧 Stream Key 立即失效，Electron 客户端需重新同步。确认重置？",
    )
  )
    return;
  setResettingKey(deviceId);
  try {
    const res = await fetch(`/api/stream/key/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    const data = await res.json();
    if (data.ok) {
      // 更新本地 devices 列表
      setDevices((prev) =>
        prev.map((d) =>
          d.id === deviceId ? { ...d, streamKey: data.newKey } : d,
        ),
      );
    } else {
      alert(`重置失败：${data.error}`);
    }
  } catch {
    alert("网络错误，请重试");
  } finally {
    setResettingKey(null);
  }
}
```

> **注意**：`RefreshCw` 图标从 `lucide-react` 引入，需在 import 语句中追加。

---

## 四、T-W3：/live 页面 — SRS 真实推流接入

### 4.1 改动范围

文件：`app/live/LivePageClient.tsx`

当前 `LivePlayer` 中的流地址为硬编码占位。本次改动：

1. 页面顶部展示**当前在线直播设备列表**（从 `/api/stream/live-devices` 获取）
2. 用户选择设备后，动态拼合 HLS 播放地址，传入 `LivePlayer`
3. 「观看人数」、「直播标题」改为从 API 读取

### 4.2 新增 State 与数据类型

```typescript
interface LiveDevice {
  deviceId: number;
  deviceName: string;
  ownerName: string;
  streamKey: string;
  hlsUrl: string; // 完整 HLS 拉流地址，由后端拼合
  viewers: number;
  bitrateKbps: number;
  durationSeconds: number;
  startedAt: string;
}
```

### 4.3 直播设备选择器（插入到播放器上方）

```tsx
// 在 LivePageClient 顶部播放区域之前插入

{
  /* 直播设备选择器 */
}
<div className="flex gap-2 flex-wrap mb-3">
  {liveDevices.length === 0 ? (
    <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
      <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
      当前没有设备正在直播
    </div>
  ) : (
    liveDevices.map((dev) => (
      <button
        key={dev.deviceId}
        onClick={() => setSelectedDevice(dev)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all
          ${
            selectedDevice?.deviceId === dev.deviceId
              ? "bg-red-500/15 border-red-500/50 text-red-400 font-semibold"
              : "bg-card border-border hover:border-primary/40 text-foreground/70"
          }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        {dev.deviceName}
        <span className="text-xs opacity-60">· {dev.viewers} 人</span>
      </button>
    ))
  )}
</div>;
```

### 4.4 LivePlayer 接入动态 HLS 地址

修改 `LivePlayer` 组件（`components/LivePlayer.tsx`），接受 `hlsUrl` prop：

```typescript
// LivePlayer.tsx — 新增 props 类型
interface LivePlayerProps {
  hlsUrl?: string; // 新增，为空时展示「等待直播」占位画面
}
```

```tsx
// LivePageClient 中调用
<LivePlayer hlsUrl={selectedDevice?.hlsUrl} />
```

`LivePlayer` 内部使用 [HLS.js](https://github.com/video-dev/hls.js) 播放（如尚未引入，执行 `npm install hls.js`）：

```typescript
// components/LivePlayer.tsx 内部实现骨架
import Hls from "hls.js";

useEffect(() => {
  if (!hlsUrl || !videoRef.current) return;
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(hlsUrl);
    hls.attachMedia(videoRef.current);
    return () => hls.destroy();
  } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari 原生 HLS
    videoRef.current.src = hlsUrl;
  }
}, [hlsUrl]);
```

### 4.5 Stream Info 区域动态化

将现有硬编码的 `"KOI Coding Stream"` / `"Watching: 1,234"` 替换为：

```tsx
<h1 className="text-xl font-bold">{selectedDevice?.deviceName ?? '等待直播开始'}</h1>
<div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
  {selectedDevice ? (
    <>
      <span className="bg-red-500 text-white px-2 py-0.5 rounded text-xs font-bold animate-pulse">LIVE</span>
      <span>观看：{selectedDevice.viewers.toLocaleString()}</span>
      <span>·</span>
      <span>{selectedDevice.ownerName}</span>
      <span>·</span>
      <span>{formatDuration(selectedDevice.durationSeconds)}</span>
    </>
  ) : (
    <span>暂无直播</span>
  )}
</div>
```

```typescript
// 工具函数（追加到文件内）
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
```

### 4.6 数据轮询

```typescript
// 设备列表每 15s 刷新一次（非 WebSocket 阶段）
useEffect(() => {
  fetchLiveDevices();
  const timer = setInterval(fetchLiveDevices, 15_000);
  return () => clearInterval(timer);
}, []);

async function fetchLiveDevices() {
  const res = await fetch("/api/stream/live-devices");
  const data = await res.json();
  if (data.ok) {
    setLiveDevices(data.devices);
    // 若当前选中设备已下线，重置选择
    if (
      selectedDevice &&
      !data.devices.find(
        (d: LiveDevice) => d.deviceId === selectedDevice.deviceId,
      )
    ) {
      setSelectedDevice(null);
    }
  }
}
```

---

## 五、T-W4：Next.js API Route 层

> 这一层是网页端与后端真实 API 之间的代理层，统一处理鉴权 Cookie → API Key 转换。

### 5.1 目录结构

```
app/api/stream/
  ├── key/
  │   └── reset/
  │       └── route.ts      ← POST，重置 Stream Key（仅 admin）
  ├── status/
  │   └── route.ts          ← GET，查询指定设备推流状态
  └── live-devices/
      └── route.ts          ← GET，获取当前所有在线直播设备
```

### 5.2 `live-devices/route.ts`

```typescript
// app/api/stream/live-devices/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const BACKEND = process.env.NEKO_BACKEND_URL ?? "http://localhost:8080";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  // 调用 Neko 后端：GET /api/v1/stream/live-devices
  const res = await fetch(`${BACKEND}/api/v1/stream/live-devices`, {
    headers: { "X-Internal-Secret": process.env.INTERNAL_SECRET ?? "" },
    next: { revalidate: 0 },
  });
  const data = await res.json();
  return NextResponse.json(data);
}
```

### 5.3 `key/reset/route.ts`

```typescript
// app/api/stream/key/reset/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const BACKEND = process.env.NEKO_BACKEND_URL ?? "http://localhost:8080";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { deviceId } = await req.json();
  if (!deviceId)
    return NextResponse.json(
      { ok: false, error: "deviceId 必填" },
      { status: 400 },
    );

  // 权限校验：仅 admin 或设备所有者
  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  });
  const device = await prisma.device.findUnique({
    where: { id: Number(deviceId) },
    select: { ownerId: true, verification: true },
  });
  if (!device)
    return NextResponse.json(
      { ok: false, error: "设备不存在" },
      { status: 404 },
    );

  const isAdmin = currentUser?.role === "admin";
  const isOwner = device.ownerId === session.userId;
  if (!isAdmin && !isOwner)
    return new NextResponse("Forbidden", { status: 403 });

  // 调用后端重置 Key（携带设备的 API Key 代理请求）
  const res = await fetch(`${BACKEND}/api/v1/stream/key/reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.INTERNAL_SECRET ?? "",
    },
    body: JSON.stringify({ deviceVerification: device.verification }),
  });
  const data = await res.json();
  if (data.ok) {
    return NextResponse.json({ ok: true, newKey: data.data.stream_key });
  }
  return NextResponse.json(
    { ok: false, error: data.error?.message ?? "重置失败" },
    { status: 500 },
  );
}
```

### 5.4 环境变量（追加到 `.env.local`）

```bash
# Neko 后端内部调用地址（不对外暴露）
NEKO_BACKEND_URL=http://localhost:8080
# 内部服务间通信密钥（后端同步配置）
INTERNAL_SECRET=your_internal_secret_here
```

---

## 六、Dashboard 卡片数据来源修改（/api/devices 路由）

`/api/devices/route.ts` 的 Prisma 查询需要联查 `device_stream_keys` 表，将 `isLive` 和 `streamKey` 一并返回给 `DashboardClient`。

> 具体 Prisma 查询语句，详见《SRS直播推流-服务端与数据库补充方案.md》第四章。

网页端 `DeviceData` 接口增量更新（**不修改现有字段**）：

```typescript
// 在 DashboardClient.tsx 及 DeviceStatusCard.tsx 中追加到 ApiDevice / DeviceData interface
isLive?:    boolean
streamKey?: string   // 仅 owner 或 admin 的请求中返回，普通用户返回 undefined
```

---

## 七、安全要求

| 要求            | 说明                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| Stream Key 脱敏 | 普通用户请求 `/api/devices` 时，response 中一律不包含 `streamKey` 字段；仅 `isLive` 展示 |
| 管理员限制      | `/api/stream/key/reset` 严格校验角色，非 admin + 非 owner 的请求返回 `403`               |
| 内部密钥隔离    | Next.js → Neko 后端通信使用 `INTERNAL_SECRET`，不使用用户的 Cookie/Session 越权          |
| HLS 地址可见性  | HLS 拉流地址通过 `/api/stream/live-devices` 返回，该接口要求登录鉴权（非公开）           |

---

## 八、验收标准

- [ ] `DeviceStatusCard` 正在直播的设备显示红色脉冲 LIVE 徽标
- [ ] `/manage` 页面 — Stream Key 可查看/复制；管理员可成功重置
- [ ] 重置 Key 后卡片上的 `streamKey` 值同步更新，不刷新整页
- [ ] `/live` 页面列出当前在线直播设备；选择后 HLS.js 正常播放流
- [ ] 无直播设备时显示「当前没有设备正在直播」占位文案
- [ ] TypeScript 编译零错误（`tsc --noEmit`）
- [ ] 普通用户的 `/api/devices` 响应中不包含 `streamKey` 字段

---

_文档责任人：开发经理 | 下发对象：WEB_NF2 Next.js 前端开发人员_
