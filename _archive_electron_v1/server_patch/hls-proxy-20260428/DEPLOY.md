# HLS Proxy Patch Deployment

This patch is for `WEB_NF2/my-app`.

## Problem

The live page can show a device as live, but the browser fails to load HLS when it directly requests:

```text
http://rtmp1.koirin.com:58080/live/<streamKey>.m3u8
```

Common causes are HTTPS mixed-content blocking, missing CORS headers on SRS, or browser/network policy blocking the public HLS port.

## Files

Copy these files into the same paths on the web server:

- `my-app/app/api/stream/hls/[...path]/route.ts`
- `my-app/app/api/stream/live-devices/route.ts`
- `my-app/app/api/v1/stream/status/route.ts`
- `my-app/middleware.ts`

## Environment

Keep this variable configured on the web server. If the SRS HLS service may be exposed on multiple mapped ports, prefer the comma-separated variable:

```env
SRS_HLS_BASE_URLS=http://rtmp1.koirin.com:58080,http://rtmp1.koirin.com:58088
```

Single-base configuration is still supported:

```env
SRS_HLS_BASE_URL=http://rtmp1.koirin.com:58080
```

Optional variables. If omitted, the web server derives the host from `SRS_HLS_BASE_URL` and uses API port `51985`:

```env
SRS_API_HOST=rtmp1.koirin.com
SRS_API_PORT=51985
SRS_API_USERNAME=root
SRS_API_PASSWORD=<fill on server>
```

The browser will no longer request this URL directly. The web server proxies HLS through same-origin URLs:

```text
/api/stream/hls/live/<streamKey>.m3u8
```

`middleware.ts` allows `/api/stream/hls/*` without a page session. The stream key in the URL is treated as the playback token, and this avoids HLS.js manifest/segment requests being redirected to the login page.

## Deploy

```powershell
npm run build
pm2 restart neko-server
pm2 logs neko-server --lines 50
```

## Verify

After OBS starts streaming, open the browser devtools Network tab and confirm the player requests:

```text
/api/stream/hls/live/<streamKey>.m3u8
/api/stream/hls/live/<segment>.ts
```

These requests should return `200`. If the proxy returns `502`, the web server cannot fetch SRS HLS and the server should test access to `SRS_HLS_BASE_URL` from the web server host.

The live device list now also queries SRS `/api/v1/streams` directly. If OBS says it is streaming but the live page shows no device, verify that SRS API returns the stream and that OBS is using the same stream key as the desktop client.

If the live page still reports HLS loading failure, check:

```powershell
curl http://rtmp1.koirin.com:51985/api/v1/streams
curl http://rtmp1.koirin.com:58080/live/<streamKey>.m3u8
curl http://rtmp1.koirin.com:58088/live/<streamKey>.m3u8
```

`/api/v1/streams` must contain `<streamKey>`. At least one HLS URL must return `200`.
