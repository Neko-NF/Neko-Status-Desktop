# Neko Status — 待完善功能清单

> **文档目的**：帮助后续开发者快速了解 Electron 客户端的当前完成度与尚待实现的部分。  
> **最后更新**：2026-03-09

---

## 已完成 ✅

| 模块             | 说明                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| **项目骨架**     | Electron 主进程/渲染进程分离，CommonJS 模块化结构                                                 |
| **UI 全页面**    | 仪表盘 / 设备状态 / 截图与活动 / 服务与自启动 / 更新中心 / 设置 / 关于 全部 HTML+CSS 静态结构完成 |
| **玻璃拟态主题** | 深/浅色模式切换 + 5色主题色切换，储存于 `localStorage`                                            |
| **系统托盘**     | 托盘图标、右键菜单（停止/启动服务、显示窗口、退出）、单击显示窗口                                 |
| **关闭行为**     | `ask`（弹窗询问）/ `minimize`（最小化到托盘）/ `exit`（直接退出）三种模式                         |
| **开机自启动**   | `app.setLoginItemSettings` 封装，含延迟启动参数 `--autostart`                                     |
| **上报服务**     | `StatusService`：定时器驱动、`online`/`away` 状态切换、日志回调、Tick 回调                        |
| **活动窗口检测** | PowerShell `Get-Process` 近似前台窗口，返回 title 与 processName                                  |
| **用户空闲检测** | PowerShell `GetLastInputInfo` 获取空闲毫秒数                                                      |
| **电池信息**     | PowerShell `Win32_Battery` WMI 查询，返回电量与充电状态                                           |
| **屏幕截图**     | Electron `desktopCapturer` 封装，返回 PNG Buffer                                                  |
| **API 上报 V2**  | `multipart/form-data` 上报，含截图、音乐、设备指纹字段                                            |
| **设备配对握手** | POST `/api/pair/handshake`，写入 `deviceKey` / `deviceId`                                         |
| **配置持久化**   | `ConfigStore`：基于本地 JSON 文件，含完整默认值                                                   |
| **IPC 完整封装** | `ipc-bridge.js` + `app-ipc.js` 双层架构，控制台日志实时推送                                       |
| **基础更新检查** | `checkForUpdates()` 对接 GitHub API `/releases/latest`                                            |

---

## 待完善 🔧

### P0 — 必须完成（影响基础使用）

#### 1. 三通道自动更新（完整链路）

- **现状**：`checkForUpdates()` 仅查询 `stable`（`/releases/latest`），无通道概念；前端"检查更新"按钮和通道选择 radio 按钮尚未接入 IPC。
- **待做**：
  - [ ] `config-store.js`：添加 `updateChannel: 'stable'` 默认值
  - [ ] `main.js`：`checkForUpdates` 支持 `stable` / `beta` / `nightly` 三通道逻辑
  - [ ] `main.js`：添加 `update:getChannel` / `update:setChannel` IPC
  - [ ] `main.js`：实现下载进度推送（`stream` 分块读取 → `update:progress`）
  - [ ] `main.js`：下载 ZIP → 解压 → 生成 `update.bat` → 执行并退出（交接文档 07 完整流程）
  - [ ] `app-ipc.js`：绑定"检查更新"按钮、通道 radio、下载进度条、"立即安装"按钮

#### 2. electron-builder 打包配置

- **现状**：`package.json` 无 `build` 字段，无法打包。
- **待做**：
  - [ ] 添加 `electron-builder` devDependency
  - [ ] 配置 NSIS 安装包 + ZIP 便携包双输出，see [RELEASE_GUIDE.md](./RELEASE_GUIDE.md)

#### 3. 设置页面实际接入

- **现状**：设置页面 HTML 已存在，但输入框/开关未绑定配置读写。
- **待做**：
  - [ ] 页面加载时从 IPC 读入 `serverMode`、`serverUrlProd`、`serverUrlLocal`、`reportInterval`、`deviceKey`
  - [ ] 保存按钮调用 `ipc.setManyConfig()`，修改间隔后 `ipc.restartService()`

### P1 — 重要功能（影响核心体验）

#### 4. 渲染进程 UI 数据绑定（仪表盘）

- **现状**：仪表盘所有卡片数据均为静态 HTML mock。
- **待做**：
  - [ ] `app:init` 事件处理：填充版本号、设备名、当前服务状态、Battery
  - [ ] `service:tick` 事件：实时更新"最后上报应用"、电量、健康度统计
  - [ ] `service:statusChanged` 事件：更新"停止/启动上报"按钮状态与仪表盘状态卡
  - [ ] `reportToggleBtn`：点击调用 `ipc.startService()` / `ipc.stopService()`

#### 5. 截图页面数据接入

- **现状**：截图预览框 + 活动流均为静态 mock。
- **待做**：
  - [ ] `captureNowBtn`：调用 `ipc.captureScreen()`，将返回 Buffer 转为 `blob:` URL 显示在预览框
  - [ ] 截图成功后，向活动列表追加一条记录
  - [ ] 截图开关 `uploadSwitch`：绑定 `enableScreenshot` 配置

#### 6. 服务与自启动页面接入

- **现状**：开关和步进器均为静态，无 IPC 通信。
- **待做**：
  - [ ] `autoStartSwitch`：绑定 `ipc.enableAutoStart()` / `ipc.disableAutoStart()`，初始化时读取状态
  - [ ] `reportAutoStartSwitch`：绑定 `enableAutoServiceStart` 配置
  - [ ] `startDelayInput`：绑定 `startupDelayMs` 配置
  - [ ] 服务状态 pill（`reporterStatus`）：响应 `service:statusChanged` 实时刷新

#### 7. 媒体信息检测（SMTC）

- **现状**：`status-service.js` 传 `music: null`，未采集。旧版使用自定义 C++ 插件 `power_pulse_media`。
- **待做**：
  - [ ] 方案 A（推荐）：使用 `@jellybrick/wql-process-monitor` 或 `node-smtc` 读取 Windows Runtime SMTC 接口
  - [ ] 方案 B（兼容）：PowerShell WinRT BridgeCall 脚本，解析当前媒体信息
  - [ ] 封装至 `system-utils.js` 的 `getMediaInfo()` 方法
  - [ ] `status-service.js` `_tick()` 中接入 `music` 字段上报

### P2 — 次要功能（增强体验）

#### 8. 设备状态页面数据接入

- **现状**：KPI 卡片（CPU、内存、网络、电量）均为静态 mock。
- **待做**：
  - [ ] CPU 负载：PowerShell `Get-CimInstance Win32_Processor` 定时轮询
  - [ ] 内存使用：`os.totalmem()` / `os.freemem()` 即可获取
  - [ ] 网络延迟：`ping` API 服务器
  - [ ] 历史诊断表格：读取 `StatusService` 内存日志并渲染到 `historyTableBody`

#### 9. 仪表盘图表

- **现状**：`card-chart` 卡片内为占位文字 `[ECharts / Chart.js 图表渲染区域]`。
- **待做**：
  - [ ] 引入 Chart.js（体积小，推荐）或 ECharts
  - [ ] 维护一个环形缓冲区记录最近 N 次 tick 的 CPU/内存读数
  - [ ] 渲染折线图，支持 1h / 6h / 24h 三档时间轴

#### 10. 关于页面动态化

- **现状**：关于页面为完全静态 HTML，版本号为硬编码字符串。
- **待做**：
  - [ ] 页面加载时调用 `ipc.getVersion()` 填入版本号显示区域
  - [ ] 填入 `package.json` 中的 `author`、`description` 等字段

#### 11. 设备状态 → 历史诊断交互

- **待做**：
  - [ ] 筛选器 `#historyFilterGroup` 的 Segmented 滑动效果真实响应数据过滤
  - [ ] "一键修复"按钮接入实际权限修复逻辑（目前 UI 仅展示）

---

## 架构说明 / 注意事项

### 单进程架构（无独立 Daemon）

UI 中展示的 `NekoDaemon.exe` 在当前实现中即为 Electron 主进程本身。如需将来实现守护进程与 UI 分离，需要拆分主进程并通过 Named Pipe / IPC Socket 通信。**当前阶段无需实现**，保持单进程即可。

### 设备指纹稳定性

当前使用 `hostname-platform-arch` base64 作为指纹，设备改名后会变更。如需更稳定的指纹，可采用主网卡 MAC 地址（PowerShell `Get-NetAdapter | Select-Object MacAddress`）进行哈希。

### 更新机制安全

下载完成后必须进行 SHA256 校验再执行，防止中间人篡改安装包。见 [RELEASE_GUIDE.md](./RELEASE_GUIDE.md) 中"安全校验"一节。
