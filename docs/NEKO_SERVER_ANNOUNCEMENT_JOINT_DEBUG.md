# neko-server 公告接口联调记录与操作规范

> 记录日期：2026-06-02  
> 适用项目：`Z:\NF\neko-server` / 线上 `https://nekostatus.koirin.com`  
> 桌面端项目：`D:\VScode project\Neko_Status`

## 1. 背景与症状

桌面端新增公告功能后，请求：

```bash
GET https://nekostatus.koirin.com/api/announcements
Authorization: Bearer <desktop JWT>
```

预期返回 JSON：

```json
{
  "announcements": [],
  "total": 0
}
```

实际曾出现：

- HTTP 200 + Next.js 登录页 HTML
- 或无 token 时 307 跳转到 `/login?redirect=/api/announcements`
- 桌面端报错：服务端返回非 JSON 响应

关键判断：这不是桌面端解析问题，而是服务端 API 被页面登录中间件拦截，最终返回了 HTML。

## 2. 线上源码与访问方式

线上正在部署的源码不在 `WEB_NF2`，而在：

```text
Z:\NF\neko-server
```

`Z:` 是远程磁盘映射。服务器上的真实路径是：

```text
E:\NF\neko-server
```

可以通过 SSH 访问服务器：

```bash
ssh -p 39522 NF@nekostatus.koirin.com
```

Codex 内可用非交互探测：

```powershell
ssh -p 39522 -o BatchMode=yes NF@nekostatus.koirin.com "hostname"
```

服务器是 Windows，默认远端 shell 是 `cmd`。如果需要执行复杂 PowerShell，建议使用 `-EncodedCommand`，避免管道和引号被 `cmd` 或本地 PowerShell 吃掉。

## 3. 根因

本次确认到三个服务端问题：

1. `middleware.ts` 没有放行 `/api/announcements`

   结果是请求先被页面级登录保护拦截，未认证时跳转 `/login`，API 调用拿到 HTML。

2. `app/api/announcements/route.ts` 只读取 Web cookie session

   桌面端使用的是 `POST /api/auth/login` 返回的 JWT，并通过：

   ```text
   Authorization: Bearer <jwt>
   ```

   发送给服务端。公告 API 必须支持 Bearer JWT。

3. `app/api/announcements/[id]/route.ts` 缺失

   目录存在，但 route 文件不存在。编辑、删除公告接口会 404 或落入 fallback。

另一个构建问题：

- `next build` 在服务器 TypeScript 阶段发生 Node OOM。
- 单独运行 `npx tsc --noEmit` 可以通过。
- 因此使用 `next.config.ts` 的 `typescript.ignoreBuildErrors = true` 绕过 Next 内置类型检查，但必须先单独跑 `tsc`。

## 4. 修复方案

### 4.1 middleware 放行公告 API

在 `Z:\NF\neko-server\middleware.ts` 的 `publicPaths` 加入：

```ts
'/api/announcements'
```

含义：只跳过页面登录重定向，让 API route 自己返回 JSON 鉴权结果。不是公开无鉴权访问。

### 4.2 支持桌面端 Bearer JWT

在 `Z:\NF\neko-server\lib\session.ts` 增加：

```ts
export async function getRequestSession(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const payload = await decrypt(authHeader.substring(7))
    if (payload?.source === 'desktop-client' && payload.userId) {
      return payload
    }
  }

  return await getSession()
}
```

公告 API 使用 `getRequestSession(request)`，兼容：

- 桌面端 Bearer JWT
- Web 端 cookie session

### 4.3 修复公告列表/创建路由

文件：

```text
Z:\NF\neko-server\app\api\announcements\route.ts
```

要求：

- `GET`：登录用户可获取 active 且未过期公告。
- `GET ?all=true`：仅管理员可看全部公告。
- `POST`：仅管理员可创建公告。
- 未登录必须返回 JSON `401`，不能跳转登录页。
- 非管理员创建必须返回 JSON `403`。

### 4.4 补充编辑/删除路由

文件：

```text
Z:\NF\neko-server\app\api\announcements\[id]\route.ts
```

要求：

- `PUT /api/announcements/:id`：仅管理员编辑。
- `DELETE /api/announcements/:id`：仅管理员删除。
- 无效 ID 返回 `400`。
- 不存在公告返回 `404`。
- 所有错误都返回 JSON。

## 5. 构建与重启流程

服务器实际项目目录：

```text
E:\NF\neko-server
```

先做类型检查：

```powershell
cd E:\NF\neko-server
npx tsc --noEmit --pretty false
```

如果通过，再构建：

```powershell
npm run build
```

服务器内存紧张时，`next build` 可能在 TypeScript 阶段 OOM。当前处理方式：

```ts
// next.config.ts
typescript: {
  ignoreBuildErrors: true,
}
```

注意：这要求发布前必须单独跑 `npx tsc --noEmit`。

启动端口固定为 `7452`：

```powershell
$env:PORT=7452
npm run start
```

如果通过 SSH 启动，普通 `Start-Process` 可能在 SSH 会话结束后退出。更稳妥的方式是使用计划任务拉起：

```powershell
$taskName = 'NekoServerCodexStart'
$arg = '/c "cd /d E:\NF\neko-server && set PORT=7452 && npm run start > E:\NF\neko-server\start-codex.log 2>&1"'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arg
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force
Start-ScheduledTask -TaskName $taskName
```

检查监听：

```cmd
netstat -ano | findstr :7452
```

## 6. 验证清单

### 6.1 无 token 请求

```bash
curl -i https://nekostatus.koirin.com/api/announcements -H "Accept: application/json"
```

正确结果：

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
```

```json
{"error":"Unauthorized"}
```

错误结果：

- `307 Temporary Redirect`
- `/login?...`
- `text/html`
- Next.js 登录页 HTML

### 6.2 假 token 请求

```bash
curl -i https://nekostatus.koirin.com/api/announcements ^
  -H "Authorization: Bearer invalid" ^
  -H "Accept: application/json"
```

正确结果同样是 JSON `401`。

### 6.3 有效管理员 token

使用桌面端登录后拿到 JWT，测试：

```bash
curl -i https://nekostatus.koirin.com/api/announcements ^
  -H "Authorization: Bearer <JWT>" ^
  -H "Accept: application/json"
```

应返回：

```json
{
  "announcements": [],
  "total": 0,
  "hasMore": false
}
```

创建公告：

```bash
curl -i -X POST https://nekostatus.koirin.com/api/announcements ^
  -H "Authorization: Bearer <ADMIN_JWT>" ^
  -H "Content-Type: application/json" ^
  --data "{\"title\":\"测试公告\",\"content\":\"联调测试\",\"type\":\"info\"}"
```

## 7. 注意事项

- 不要把 `WEB_NF2` 当作线上源码。线上实际部署源码是 `Z:\NF\neko-server` / `E:\NF\neko-server`。
- 不要只看 HTTP 状态码。`curl -L` 会跟随 307，最终显示 200 HTML，容易误判。
- API 端点必须返回 JSON 错误，不应走页面登录重定向。
- 桌面端认证使用 Bearer JWT，不是 Web cookie。
- `next build` OOM 不等于代码错。先跑 `npx tsc --noEmit` 分离类型错误和构建资源问题。
- 当前服务器是 Windows，SSH 远程命令的引号和管道容易被 `cmd` 解析。复杂命令优先用 PowerShell `-EncodedCommand`。
- 重启服务前先确认旧进程 PID，避免端口 7452 被占用。
- 通过 SSH 启动长期进程时，优先使用计划任务或服务器本地进程管理方式，避免 SSH 会话结束导致进程退出。

## 8. 本次最终状态

已确认：

- `npx tsc --noEmit --pretty false` 通过。
- `npm run build` 成功。
- 构建路由表包含：
  - `/api/announcements`
  - `/api/announcements/[id]`
- 服务器 `7452` 端口已恢复监听。
- 公网 `/api/announcements` 无 token / 假 token 均返回 JSON `401`，不再返回登录 HTML。

