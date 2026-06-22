# neko-server 服务端改动 Agent 操作规范

> 适用范围：所有涉及 `neko-server`、线上 API、网页 UI、数据库读写、构建、重启、联调验证的改动。  
> 参考案例：`docs/NEKO_SERVER_ANNOUNCEMENT_JOINT_DEBUG.md` 与 2026-06-08 客户端版本号上报联调。
> 关注动态联调的专项踩坑记录见 `docs/用户关注与应用在线提醒/07_联调与开发踩坑记录.md`。

## 1. 角色与职责

### 需求提出人 / 负责人

- 明确本次改动是否需要上线服务端。
- 明确是否允许短暂停服、是否允许写入测试数据、是否有必须保护的线上行为。
- 提供必要的测试账号、设备 key、管理员 token 或可替代的验证路径。

### 桌面端 Agent

- 先完成桌面端改动和本地验证，确认请求字段、IPC、配置、UI 状态都可复现。
- 若改动需要服务端支持，必须同步检查 `neko-server` 对应 API、网页 UI 和数据流。
- 不得只改桌面端就声称联调完成。

### 服务端 Agent

- 负责 `E:\NF\neko-server` / `Z:\NF\neko-server` 的代码、构建、重启、线上接口验证。
- 必须证明线上新构建已加载，而不是只证明源码已修改。
- 对任何停服、删除数据、写入线上测试数据的操作保持最小化，并在结果中说明影响。

### 人类运维 / Owner

- 当需要较长停服、重启非 `neko-server` 进程、清理服务器内存、修改计划任务或环境变量时，由人类明确授权。
- Agent 只能在授权范围内操作，不得为了构建成功随意停止其他业务进程。

## 2. 路径与访问事实

线上源码位置：

```text
Z:\NF\neko-server
```

服务器真实路径：

```text
E:\NF\neko-server
```

SSH：

```powershell
ssh -p 39522 -o BatchMode=yes NF@nekostatus.koirin.com "hostname"
```

注意：

- `Z:` 是远程映射盘，适合快速查看和小范围编辑，不适合长时间构建。
- 构建、重启、端口检查应优先通过 SSH 在服务器本机 `E:\NF\neko-server` 执行。
- 远端默认 shell 是 `cmd`，复杂 PowerShell 命令优先使用 `-EncodedCommand`，避免中文、管道和引号被错误解析。
- 命令和文件读取涉及中文时必须使用 UTF-8。

## 3. 服务端改动前检查

每次服务端改动前，Agent 必须确认：

1. 本次改动涉及哪些端点、页面、数据表和客户端字段。
2. 线上当前是否有服务监听：

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq 7452 }
```

3. 当前 `neko-server` 进程：

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'E:\\NF\\neko-server' }
```

4. 服务器内存是否足够：

```powershell
Get-CimInstance Win32_OperatingSystem |
  Select-Object @{Name='FreeGB';Expression={[math]::Round($_.FreePhysicalMemory/1MB,2)}},
                @{Name='FreeVirtualGB';Expression={[math]::Round($_.FreeVirtualMemory/1MB,2)}}
```

5. 工作区已有未提交改动。不要覆盖非本次任务产生的改动。

## 4. 代码实现要求

涉及 API 契约时必须同时覆盖：

- 桌面端发送字段。
- 服务端 API 接收、校验、存储或透传字段。
- 网页端查询 API 返回字段。
- 网页 UI 显示字段。
- 失败态和旧客户端兼容。

接口必须返回 JSON 错误，不应让 API 请求落入页面登录重定向或 HTML 登录页。

涉及桌面端 Bearer JWT 的 API，不能只读 Web cookie session；需要兼容：

- `Authorization: Bearer <desktop JWT>`
- Web cookie session

涉及线上状态写入时，优先选择影响最小的验证端点。例如客户端元数据可使用 `/api/device/meta`，不要为了验证字段随意创建公告、删除设备或污染应用使用历史。

## 5. 本地与远端验证顺序

推荐顺序：

1. 桌面端本地验证：

```powershell
npm run verify
```

2. 服务端源码静态确认：

```powershell
rg -n "目标字段|目标端点" app components lib middleware.ts
```

3. 远端类型检查：

```powershell
cd E:\NF\neko-server
npx tsc --noEmit --pretty false
```

4. 远端构建。

5. 重启服务。

6. 公网接口验证。

7. 数据库或页面 API 验证。

8. 构建产物验证，例如 `.next` 中是否包含目标逻辑。

不能跳过第 5-8 步就声称“服务端联调完成”。

## 6. 构建策略

默认不要在 `Z:` 映射盘上长时间运行：

```powershell
npm run build
```

优先 SSH 到服务器本机执行：

```powershell
cd E:\NF\neko-server
npm run build
```

Next 16 默认可能走 Turbopack。若出现原生崩溃或 `-1073741819`，改用 webpack：

```powershell
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:NODE_OPTIONS = '--max-old-space-size=4096'
npx next build --webpack
```

如果构建 OOM：

- 先确认是不是 TypeScript 错误。单独跑 `npx tsc --noEmit --pretty false`。
- 如果 `tsc` 通过，Next 构建 OOM 才按资源问题处理。
- 检查内存。若当前 `neko-server` 旧进程占用内存且负责人允许，可以先停 7452 再构建。
- 不得擅自停止其他业务进程来腾内存。

如果服务器构建仍失败：

- 可以考虑在本机临时目录复制源码并构建，再同步 `.next` 产物。
- 同步产物前必须确认依赖版本、环境变量和构建平台兼容。
- 同步产物不是首选路径，优先服务器本机构建。

## 7. 停服与重启流程

停服前确认监听 PID：

```powershell
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq 7452 }
$listen
```

只停止 `E:\NF\neko-server` 对应进程：

```powershell
$ids = @()
$ids += $listen.OwningProcess
$ids += (Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'E:\\NF\\neko-server' } |
  Select-Object -ExpandProperty ProcessId)
$ids | Sort-Object -Unique | ForEach-Object {
  Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
}
```

重启使用计划任务，避免 SSH 会话结束导致服务退出：

```powershell
$taskName = 'NekoServerCodexStart'
$arg = '/c "cd /d E:\NF\neko-server && set PORT=7452 && npm run start > E:\NF\neko-server\start-codex.log 2>&1"'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arg
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force
Start-ScheduledTask -TaskName $taskName
```

启动后必须确认：

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq 7452 }

Get-Content E:\NF\neko-server\start-codex.log -Encoding UTF8 -Tail 80
```

日志应包含：

```text
next start
Local: http://localhost:7452
Ready
```

## 8. 生效证明

每次服务端上线后，Agent 必须给出至少三类证据。

### 构建证据

- `npx tsc --noEmit --pretty false` 通过，或说明为什么无法完成。
- `next build` 成功，日志含 `EXITCODE:0`。
- `.next\BUILD_ID`、`.next\routes-manifest.json` 时间更新。

### 进程证据

- 7452 正在监听。
- 监听 PID 的命令行为：

```text
E:\NF\neko-server\node_modules\.bin\..\next\dist\bin\next start
```

### 行为证据

按改动选择最小线上验证：

- 无鉴权 API 应返回 JSON 错误而不是 HTML。
- 写入型 API 使用最小影响 payload。
- 字段透传改动必须验证请求、响应、数据库或网页 API。
- 网页 UI 改动应确认构建产物或页面可见状态。

示例：验证客户端版本号字段：

```powershell
$body = @{
  deviceKey = '<DEVICE_KEY>'
  reportEnabled = $true
  captureEnabled = $false
  clientVersion = '1.3.0'
  appVersion = '1.3.0'
} | ConvertTo-Json -Compress

Invoke-WebRequest `
  -Uri 'https://nekostatus.koirin.com/api/device/meta' `
  -Method POST `
  -ContentType 'application/json' `
  -Body $body `
  -UseBasicParsing
```

再查 `__neko_meta__` 或调用对应查询 API，确认 `clientVersion` 已保存并能被 `/api/devices` 解析。

主上报接口示例应使用明确 UTF-8 multipart，不建议用 Windows 下容易被转义破坏的 `curl --form-string`。可用 .NET `MultipartFormDataContent`。

## 9. 超时处理规则

不要让长命令在前台硬等到工具超时后就停止分析。

如果命令可能超过 60 秒：

- 优先在远端写日志文件。
- 轮询日志和进程状态。
- 明确记录进程 PID。
- 命令结束后检查退出码和日志尾部。

如果本地工具超时但远端进程仍在运行：

1. 查进程命令行。
2. 判断是否仍有进展，例如 `.next` 文件时间、日志增长。
3. 卡住时只停止本次构建相关进程。
4. 不要留下 `tsc`、`next build`、`robocopy` 等残留进程。

## 10. 回滚与风险控制

如果构建成功但启动失败：

- 保留 `build-codex.log` 和 `start-codex.log`。
- 不要删除旧日志。
- 如果旧 `.next` 已被覆盖，优先根据 Git 或备份恢复源码后重建。
- 若只是新服务启动失败且旧进程已停，应立即向负责人说明停服状态和下一步选择。

如果线上验证发现数据异常：

- 停止继续写入测试请求。
- 记录请求 payload、响应、时间、设备 ID。
- 只回滚本次服务端改动，不回滚无关工作区变更。

## 11. Agent 最终回复必须包含

服务端相关任务完成后，最终回复必须写清：

- 修改了哪些服务端文件。
- 是否执行了 `tsc`。
- 是否执行了 `next build`，使用 Turbopack 还是 webpack。
- 是否停服，停服原因和大致影响。
- 是否重启成功，端口和 PID。
- 用哪些公网 API 验证了新行为。
- 是否写入了线上测试数据，写入了什么。
- 仍存在的风险或日志异常。

不能只说“已部署”或“已验证”，必须给出可复核证据。
