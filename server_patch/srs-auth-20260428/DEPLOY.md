# SRS Auth Patch Deployment

This package is for `WEB_NF2/my-app`.

## Files

Copy these files into the same paths on the server:

- `my-app/lib/srs-api.ts`
- `my-app/app/api/v1/stream/test-srs/route.ts`
- `my-app/app/api/v1/stream/status/route.ts`
- `my-app/app/api/stream/test-srs/route.ts`

## Environment

Set these variables in the server environment or `my-app/.env.local`:

```env
SRS_HLS_BASE_URL=http://rtmp1.koirin.com:58080
SRS_API_USERNAME=root
SRS_API_PASSWORD=<fill on server>
```

Do not put the SRS API password into the desktop client. The desktop client only sends SRS host and port settings to the web server. The web server uses these environment variables to call SRS HTTP API.

Recommended desktop SRS settings:

```text
SRS host: rtmp1.koirin.com
RTMP port: 51935
HTTP API port: 51985
SRS app: live
```

## Verify

After copying files:

```powershell
npm run build
pm2 restart neko-server
pm2 logs neko-server --lines 50
```

Then test from the desktop app settings page, or call:

```powershell
curl -X POST https://<web-server>/api/v1/stream/test-srs ^
  -H "Content-Type: application/json" ^
  -H "X-API-Key: <device-key>" ^
  --data "{\"srs_host\":\"rtmp1.koirin.com\",\"srs_rtmp_port\":51935,\"srs_api_port\":51985}"
```
