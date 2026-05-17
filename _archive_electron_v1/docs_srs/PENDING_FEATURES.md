# Neko Status — 功能完成度清单

> **文档目的**：帮助后续开发者快速了解 Electron 客户端的当前完成度与尚待实现的部分。  
> **最后更新**：2026-03-09（P0/P1/P2 已全部完成）

---

## 已完成 ✅

| 模块                 | 说明                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **项目骨架**         | Electron 主进程/渲染进程分离，CommonJS 模块化结构                                                 |
| **UI 全页面**        | 仪表盘 / 设备状态 / 截图与活动 / 服务与自启动 / 更新中心 / 设置 / 关于 全部 HTML+CSS 静态结构完成 |
| **玻璃拟态主题**     | 深/浅色模式切换 + 5色主题色切换，储存于 `localStorage`                                            |
| **系统托盘**         | 托盘图标、右键菜单（停止/启动服务、显示窗口、退出）、单击显示窗口                                 |
| **关闭行为**         | `ask`（弹窗询问）/ `minimize`（最小化到托盘）/ `exit`（直接退出）三种模式，设置页可切换           |
| **开机自启动**       | `app.setLoginItemSettings` 封装，含延迟启动参数 `--autostart`                                     |
| **单实例运行**       | `app.requestSingleInstanceLock()`，二次启动时激活已有窗口                                         |
| **上报服务**         | `StatusService`：定时器驱动、`online`/`away` 状态切换、日志回调、Tick 回调                        |
| **活动窗口检测**     | PowerShell `Get-Process` 近似前台窗口，返回 title 与 processName                                  |
| **用户空闲检测**     | PowerShell `GetLastInputInfo` 获取空闲毫秒数                                                      |
| **电池信息**         | PowerShell `Win32_Battery` WMI 查询，返回电量与充电状态                                           |
| **SMTC 媒体检测**    | PowerShell WinRT `GlobalSystemMediaTransportControlsSessionManager`，返回标题/歌手/进度/应用名    |
| **应用图标提取**     | `electron.app.getFileIcon()` 提取前台应用 PNG 图标并上报                                          |
| **屏幕截图**         | Electron `desktopCapturer` 封装，独立截图间隔控制，超大截图检测                                   |
| **API 上报 V2**      | `multipart/form-data` 上报，含截图、音乐、图标、设备指纹字段                                      |
| **设备配对握手**     | POST `/api/pair/handshake`，写入 `deviceKey` / `deviceId`                                         |
| **设备密钥验证**     | GET `/api/device/validate`，启动时校验密钥有效性                                                  |
| **密钥状态处理**     | 完整处理 KEY_REVOKED / DEVICE_NOT_FOUND / TAKEOVER_SUCCESS，自动停止服务并通知渲染进程            |
| **配置持久化**       | `ConfigStore`：基于本地 JSON 文件，含完整默认值                                                   |
| **IPC 完整封装**     | `ipc-bridge.js` + `app-ipc.js` 双层架构，控制台日志实时推送                                       |
| **三通道更新**       | stable/beta/nightly 通道切换，GitHub Releases 过滤+semver 比较，下载进度推送+SHA256 校验+安装     |
| **更新中心 UI**      | 检查更新、强制更新、通道切换、更新源配置、release notes 渲染、跳过版本、本地安装、下载进度条      |
| **设置页完整接入**   | 所有开关绑定配置（自启/托盘/更新/截图/通知/勿扰等），上报间隔持久化                               |
| **网络等待**         | 开机自启时 DNS 轮询等待网络就绪（30s 超时）                                                       |
| **兜底自启服务**     | 30s 后检查服务未运行则自动启动                                                                    |
| **设备状态页**       | CPU/内存/网络延迟实时指标，元信息动态填充，电量状态实时更新                                       |
| **仪表盘图表**       | Canvas 原生绘制 CPU/内存折线图，支持 1h/6h/24h 时间范围切换                                       |
| **关于页动态化**     | 版本号、Electron/Node.js/Chromium 版本动态填充                                                    |
| **历史诊断筛选**     | 分段滑块筛选器（全部/正常/警告/错误）带动画 pill 效果                                             |
| **electron-builder** | NSIS 安装包 + ZIP 便携包双输出，见 [RELEASE_GUIDE.md](./RELEASE_GUIDE.md)                         |

---

## 未来可扩展（不阻塞当前发布）

| 模块               | 说明                                                               |
| ------------------ | ------------------------------------------------------------------ |
| WebSocket 实时推送 | 当前使用 HTTP 定时轮询，可升级为 WebSocket 双向通信，降低延迟      |
| 版本回滚           | 更新中心"版本回滚"按钮目前为占位，需实现旧版本缓存+恢复逻辑        |
| 完整性检查         | "完整性检查"按钮需对比本地文件哈希与发布清单                       |
| 截图压缩           | 超大 PNG 自动转 JPEG 降质（需引入 sharp 或类似库）                 |
| 设备指纹增强       | 当前使用 hostname-platform-arch，可改用 MAC 地址 SHA256 提高稳定性 |
| 系统通知集成       | CPU/内存超阈值时弹窗提醒（stgNotifySwitch 已接入配置，需触发逻辑） |
| 守护进程分离       | 将服务拆为独立 Daemon 进程，UI 进程退出不影响上报                  |

---

## 架构说明 / 注意事项

### 单进程架构（无独立 Daemon）

UI 中展示的 `NekoDaemon.exe` 在当前实现中即为 Electron 主进程本身。如需将来实现守护进程与 UI 分离，需要拆分主进程并通过 Named Pipe / IPC Socket 通信。**当前阶段无需实现**，保持单进程即可。

### 设备指纹稳定性

当前使用 `hostname-platform-arch` base64 作为指纹，设备改名后会变更。如需更稳定的指纹，可采用主网卡 MAC 地址（PowerShell `Get-NetAdapter | Select-Object MacAddress`）进行哈希。

### 更新机制安全

下载完成后必须进行 SHA256 校验再执行，防止中间人篡改安装包。见 [RELEASE_GUIDE.md](./RELEASE_GUIDE.md) 中"安全校验"一节。
