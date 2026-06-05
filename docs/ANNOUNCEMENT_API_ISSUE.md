# 公告 API 联调问题报告

## 问题描述

桌面端通过 `Authorization: Bearer <JWT>` 请求 `GET /api/announcements` 时，服务端返回 **HTTP 200 + Next.js HTML 页面**，而非预期的 JSON 响应。

## 请求详情

| 项目 | 值 |
|------|-----|
| 请求方法 | `GET` |
| 请求 URL | `https://nekostatus.koirin.com/api/announcements` |
| 认证方式 | `Authorization: Bearer <JWT Token>`（与 `/api/auth/*` 登录接口返回的 token 一致） |
| HTTP 状态码 | `200` |
| 实际返回内容 | Next.js HTML 页面（包含 `/_next/static/chunks/...` 等构建资源引用） |

## 预期行为

根据 `CLIENT_DOCKING_GUIDE.md` 约定，`GET /api/announcements` 应返回：

```json
{
  "announcements": [
    {
      "id": 1,
      "title": "系统维护",
      "content": "...",
      "type": "warning",
      "showPopup": true,
      "pushNotification": false,
      ...
    }
  ],
  "total": 1
}
```

## 可能原因

1. **服务端尚未部署公告 API 路由** — `SERVER_UPGRADE_GUIDE.md` 中列出的以下文件可能未部署到服务端：
   - `app/api/announcements/route.ts`（公告列表 & 创建）
   - `app/api/announcements/[id]/route.ts`（公告编辑 & 删除）

2. **路由匹配问题** — Next.js 未匹配到 `/api/announcements` 动态路由，fallback 到了页面路由返回 HTML。

3. **认证中间件拦截** — 请求被 Next.js 中间件拦截并重定向到登录页，但状态码返回的是 200 而非 302/401。

## 桌面端 SDK 请求代码（供参考）

```js
const url = `${serverUrl}/api/announcements`;
const response = await fetch(url, {
  method: 'GET',
  headers: { 'Authorization': `Bearer ${token}` },
  signal: AbortSignal.timeout(10000),
});
```

- `token` 来自登录接口 `POST /api/auth/login` 返回的 JWT
- `serverUrl` 来自应用配置（当前为 `https://nekostatus.koirin.com`）

## 需服务端确认

1. 公告 API 路由文件 `app/api/announcements/route.ts` 是否已部署？
2. `app/api/announcements/[id]/route.ts` 是否已部署？
3. `prisma/schema.prisma` 中 `announcements` 表是否已同步（`npx prisma db push`）？
4. 该路由是否受中间件保护？`Authorization: Bearer` 头是否能正确通过认证？
5. 能否用 `curl` 直接测试该接口确认返回 JSON？

```bash
curl -H "Authorization: Bearer <JWT>" https://nekostatus.koirin.com/api/announcements
```
