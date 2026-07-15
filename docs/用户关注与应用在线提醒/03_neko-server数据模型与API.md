# 03 — neko-server 数据模型与 API

## 服务端开关

生产环境通过环境变量控制入口：

```env
ACTIVITY_FOLLOW_ENABLED=true
```

未开启时，activity 接口应返回功能关闭响应；客户端保持入口隐藏或禁用。

## 新增数据模型

首版新增以下 Prisma 模型，均为加法迁移：

| 模型 | 用途 |
| --- | --- |
| `UserActivityPreference` | 用户活动可见范围和全局快照分享开关 |
| `UserFollow` | 单向关注关系 |
| `UserActivityBlock` | 活动功能拉黑关系 |
| `ActivityAppCatalog` | 用户本人的应用目录和公开状态；字段仍用 `isHidden` 表达“不公开” |
| `DeviceActivityPresence` | 单设备当前 presence |
| `UserAppActivitySession` | 用户级应用在线会话 |
| `ActivitySessionSource` | 会话来源设备 |
| `FollowAppRule` | 关注者对被关注者的应用规则 |
| `ActivityEvent` | 接收方事件 Outbox |
| `ActivityAgentCredential` | Agent Token 哈希与设备绑定 |
| `ActivitySnapshot` | 短期私有应用窗口缩略图 |

保留策略：

- 稳定会话保留 30 天。
- 接收方事件保留 7 天。
- 活动快照保留 24 小时，过期时同步删除数据库记录和私有文件。
- 关注者只能读取当前状态和属于自己的事件，不开放对方完整会话历史。

不迁移、不复用、不改变语义：

- `DeviceFav`
- `StatusLog`
- `AppUsageHistory`

## Agent Token

`ActivityAgentCredential`：

- 绑定用户和设备。
- 额外绑定运行通道 `legacy / stable / dev` 与安装实例哈希；服务端只保存客户端 `installationId` 的 SHA-256，不保存原始 UUID。
- 设备可以是关注动态专用设备；不要求复用截图/完整状态上报的设备密钥。
- 数据库只保存 SHA-256 Token 哈希和安全前缀。
- 每个用户设备只保留一个有效代理凭据，重新注册会轮换旧 Token。
- 连续使用时保持有效；90 天未使用自动失效。
- 关闭关注动态、退出登录、删除活动设备或重新配置服务器时撤销；截图/完整状态上报的设备密钥变化不应撤销 Activity Agent Token。

Token scope 固定为：

```text
presence:write,events:read,bootstrap:read,snapshot:write
```

Agent Token 不能：

- 搜索用户。
- 关注 / 取消关注。
- 修改规则。
- 修改隐私。
- 拉黑 / 解除拉黑。
- 伪造用户或设备归属。

桌面 Enroll 为加法兼容请求：

```json
{
  "deviceId": 31,
  "deviceName": "LAPTOP 的活动提醒（开发版）",
  "capabilities": ["presence", "events", "tray", "snapshots"],
  "installationId": "本机当前 dev/stable profile 的稳定 UUID",
  "runtimeChannel": "dev"
}
```

- `installationId` 在各自 userData 中永久保留，退出登录、停用功能和切换账号均不得重建。
- 同一 `userId + runtimeChannel + installationHash` 重复 Enroll 必须复用同一 Activity Device；`dev` 与 `stable` 不得互相复用凭据。
- DELETE 必须指定 `deviceId`，或同时指定 `installationId + runtimeChannel`。空请求不得撤销当前用户的全部 Agent 凭据。
- 传入的旧 `deviceId` 已删除时返回 `404 DEVICE_NOT_FOUND`；客户端只清除该身份下的非敏感设备映射，并在同一次操作中无 `deviceId` 重试一次。

服务端必须从 Token 推导用户和设备。

## API 一览

| 接口 | 鉴权 | 用途 |
| --- | --- | --- |
| `POST /api/activity/agent/enroll` | 用户 JWT/Cookie | 为当前用户设备签发代理凭据 |
| `DELETE /api/activity/agent/enroll` | 用户 JWT/Cookie | 撤销当前用户设备代理凭据 |
| `GET /api/activity/agent/bootstrap` | Agent Token | 获取规则摘要、当前状态和事件游标 |
| `POST /api/activity/presence` | Agent Token | 稳定进入、心跳、隐藏、空闲、退出 |
| `POST /api/activity/snapshots` | Agent Token | 上传公开应用的短期窗口快照 |
| `GET /api/activity/snapshots/:id` | Agent Token | 事件接收者读取对应私有快照 |
| `GET /api/activity/events/stream` | Agent Token | SSE 实时事件 |
| `GET /api/activity/events` | Agent Token | SSE 降级与游标恢复 |
| `GET /api/activity/users/search` | 用户 JWT/Cookie | 模糊用户名或精确 UID 搜索 |
| `GET/POST/DELETE /api/activity/follows` | 用户 JWT/Cookie | 关注管理 |
| `GET/POST/PATCH/DELETE /api/activity/rules` | 用户 JWT/Cookie | 应用规则管理 |
| `GET/PUT /api/activity/me/privacy` | 用户 JWT/Cookie | 可见范围和快照分享开关 |
| `GET/POST/PATCH /api/activity/me/apps` | 用户 JWT/Cookie | 查询、主动公开或停止公开应用 |
| `GET /api/activity/me/followers` | 用户 JWT/Cookie | 关注者列表 |
| `GET/POST/DELETE /api/activity/blocks` | 用户 JWT/Cookie | 拉黑管理 |

## Presence 请求

`POST /api/activity/presence` 请求体最大 2KiB。

```json
{
  "protocolVersion": 1,
  "agentVersion": "0.1.0",
  "clientEventId": "uuid-or-seq",
  "sequence": 42,
  "state": "active",
  "appKey": "win32:code.exe",
  "displayName": "code.exe",
  "stableSince": "2026-06-21T08:00:00.000Z",
  "observedAt": "2026-06-21T08:00:03.000Z",
  "detectorKind": "interactive",
  "snapshotId": "optional-uuid"
}
```

`sequence` 必须是非负 signed BIGINT。安全整数范围内可使用 JSON number；超过
`9007199254740991` 后必须改用十进制字符串，禁止把已发生精度舍入的 JavaScript
number 传给服务端。同一逻辑请求重试时复用原 `sequence/clientEventId`。

`state`：

- `active`：稳定进入目标应用；服务端事件类型仍使用 `activity.entered`
- `heartbeat`
- `hidden`
- `idle`
- `offline`

服务端行为：

- 根据 Agent Token 推导 `userId` 和 `deviceId`。
- 更新 `DeviceActivityPresence`。
- 若应用不存在于 `ActivityAppCatalog`，服务端可创建为 `isHidden=true`，只进入发布方本人的未公开管理列表。
- 聚合用户级 `UserAppActivitySession`。
- 为匹配规则的关注者写入 `ActivityEvent`。
- 只绑定同用户、同设备、同应用、未过期且当前仍允许分享的 `snapshotId`。
- 多设备同用户同应用去重。
- 30 秒无心跳判定离线。

## 事件

事件类型：

- `activity.entered`
- `activity.ended`
- `activity.revoked`
- `activity.app_hidden`
- `activity.connection_reset`

SSE 规则：

- 事件先写入数据库 Outbox，再发送。
- 支持 `Last-Event-ID`。
- 每 15 秒发送连接心跳。
- SSE 不可用时 Agent 自动使用 5 秒游标轮询。
- 事件 payload 包含 `createdAtMs`，Agent 用于过滤超过 2 分钟的陈旧通知。
- `activity.entered` 可选包含 `snapshot` 元数据和受保护下载 URL；无图事件保持兼容。
- Poll 固定返回 `{ events, cursor, hasMore, reset? }`。游标过期时以 `reset: true` 和新 `cursor` 推进，不把历史事件重新作为通知发送。
- SSE 的 `activity.connection_reset` 是控制事件；Agent 读取事件中的 `cursor`（缺失时使用 SSE `id`）并持久化，但不得弹出 Toast。

## 权限判定

一个关注者可见某目标用户活动，必须同时满足：

1. 关注关系存在。
2. 目标用户 visibility 允许。
3. 关注者未被目标用户拉黑。
4. 关注者的应用规则启用。
5. 目标应用已被目标用户主动公开，即 `ActivityAppCatalog.isHidden=false`。
6. 服务端总开关开启。
7. 若携带快照，目标用户当前 `shareSnapshots=true`。

`admins` 语义：管理员也必须已经关注目标用户，避免后台全量窥探。

规则创建时也必须执行第 5 条：如果关注者手填 `.exe`，但目标用户没有公开该应用，服务端返回拒绝，不能让手填规则绕过公开目录。
