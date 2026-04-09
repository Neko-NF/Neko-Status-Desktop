# SRS 直播推流功能 — 开发任务分配与交付标准

> **文档角色**：开发经理（任务分配 + 排期 + 联调规范 + 上线标准）  
> **版本**：v1.0 | **创建日期**：2026-04-06  
> **目标版本**：Neko Status `v1.1.0-beta.1` → `v1.1.0`

---

## 一、人员分工

| 角色           | 负责范围                                                                                          | 交付产物                                 |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **前端开发**   | `index.html` DOM、`main.css` 样式、`app.js` 页面逻辑、`app-ipc.js` IPC 绑定                       | 完整 `page-stream` 页面、设置页 SRS 区块 |
| **后端开发**   | 服务端 API（`/api/v1/stream/*`）、数据库建表、SRS 代理逻辑                                        | 4 个新 REST 接口 + DB 迁移脚本           |
| **主进程开发** | `stream-service.js`、`main.js` IPC Handler 注册、`ipc-bridge.js` 扩展、`config-store.js` 新增字段 | `stream-service.js` 模块、IPC 完整链路   |
| **测试/集成**  | 前后端联调、OBS 真实环境验证、SRS Docker 搭建测试环境                                             | 联调测试报告                             |

> ⚠️ **职责红线**：前端开发不得修改主进程文件；主进程开发不得修改 `index.html`/`main.css`。IPC 接口以本文档"接口约定表"为唯一契约，双方不得单方面变更。

---

## 二、任务清单

### 阶段一：前端 UI 实现（不依赖后端，可并行开展）

| 任务 ID | 任务内容                                    | 负责人 | 估时 | 依赖  |
| ------- | ------------------------------------------- | ------ | ---- | ----- |
| FE-01   | 侧边栏新增「直播推流」导航入口              | 前端   | 0.5h | 无    |
| FE-02   | `page-stream` HTML DOM 骨架搭建             | 前端   | 2h   | FE-01 |
| FE-03   | `main.css` 新增推流页专属样式               | 前端   | 3h   | FE-02 |
| FE-04   | 设置页新增 SRS 配置区块 HTML+CSS            | 前端   | 1.5h | FE-02 |
| FE-05   | `app.js` 路由注册 + `initStreamPage()` 逻辑 | 前端   | 3h   | FE-03 |
| FE-06   | 状态横幅动态更新（轮询 + 动画）             | 前端   | 1h   | FE-05 |
| FE-07   | OBS WebSocket UI 交互逻辑                   | 前端   | 2h   | FE-05 |
| FE-08   | 帮助折叠展开动画                            | 前端   | 0.5h | FE-05 |
| FE-09   | 使用 Mock IPC 数据自测 + `npm run verify`   | 前端   | 1h   | FE-08 |

**前端阶段交付物**：完整静态页面（IPC Mock 数据驱动），所有视觉交互正常，`npm run verify` 零错误。

---

### 阶段二：后端 API 实现（可与前端并行开展）

| 任务 ID | 任务内容                                              | 负责人 | 估时 | 依赖  |
| ------- | ----------------------------------------------------- | ------ | ---- | ----- |
| BE-01   | 数据库建表：`device_stream_keys` + 迁移脚本           | 后端   | 1h   | 无    |
| BE-02   | `GET /api/v1/stream/key` 接口实现                     | 后端   | 1.5h | BE-01 |
| BE-03   | `POST /api/v1/stream/key/reset` 接口实现              | 后端   | 1h   | BE-02 |
| BE-04   | `POST /api/v1/stream/test-srs` TCP+HTTP 双探测        | 后端   | 2h   | 无    |
| BE-05   | `GET /api/v1/stream/status` 代理 SRS HTTP API         | 后端   | 2h   | BE-04 |
| BE-06   | 接口 Rate Limit（Key 重置频率限制）                   | 后端   | 0.5h | BE-03 |
| BE-07   | 接口单元测试（覆盖正常/异常路径）                     | 后端   | 2h   | BE-05 |
| BE-08   | （可选提前）`POST /api/v1/stream/on-publish` 占位实现 | 后端   | 1h   | BE-01 |

**后端阶段交付物**：所有接口通过 Postman/curl 手工测试；单元测试覆盖率 ≥ 80%；接口文档同步更新至《02_REST_API接口文档.md》。

---

### 阶段三：主进程 Bridge 实现（依赖后端 API 可用 OR Mock 服务）

| 任务 ID | 任务内容                                                    | 负责人 | 估时 | 依赖        |
| ------- | ----------------------------------------------------------- | ------ | ---- | ----------- |
| MP-01   | `config-store.js` 新增 `streamConfig` 默认字段              | 主进程 | 0.5h | 无          |
| MP-02   | `stream-service.js` 创建，实现 `getOrInitStreamKey()`       | 主进程 | 1.5h | BE-02       |
| MP-03   | `stream-service.js` 实现 `resetStreamKey()`                 | 主进程 | 0.5h | BE-03       |
| MP-04   | `stream-service.js` 实现 `getStreamLiveStatus()`            | 主进程 | 1h   | BE-05       |
| MP-05   | `stream-service.js` 实现 `testSrsConnection()`              | 主进程 | 0.5h | BE-04       |
| MP-06   | 安装 `obs-websocket-js`，实现 `testObsWebSocket()`          | 主进程 | 1.5h | 无          |
| MP-07   | 实现 `applyStreamConfigToObs()`（SetStreamServiceSettings） | 主进程 | 2h   | MP-06       |
| MP-08   | 实现 `exportObsServiceConfig()` 文件写出                    | 主进程 | 1h   | MP-01       |
| MP-09   | `main.js` IPC Handler 注册（所有 `stream:*` 频道）          | 主进程 | 1.5h | MP-02~MP-08 |
| MP-10   | `ipc-bridge.js` 扩展 `stream` 命名空间                      | 主进程 | 0.5h | MP-09       |
| MP-11   | `app-ipc.js` 挂载 `window.nekoIPC` 对应方法                 | 主进程 | 0.5h | MP-10       |

**主进程阶段交付物**：DevTools Console 可调用全部 `window.nekoIPC.stream.*` 方法并返回预期数据。

---

### 阶段四：前后端联调与 OBS 集成测试

| 任务 ID | 任务内容                                                | 负责人      | 估时 | 依赖         |
| ------- | ------------------------------------------------------- | ----------- | ---- | ------------ |
| QA-01   | 搭建本地 SRS Docker 测试环境                            | 测试        | 1h   | 无           |
| QA-02   | 联调：SRS 未配置 → 引导卡片正确展示                     | 前端+测试   | 0.5h | FE-09, MP-01 |
| QA-03   | 联调：填写 SRS 配置 → 保存 → 刷新后 Stream Key 正确展示 | 前后端      | 1h   | FE-09, BE-02 |
| QA-04   | 联调：OBS WebSocket 一键配置 → OBS 推流地址自动更新     | 主进程+测试 | 1.5h | MP-07, QA-01 |
| QA-05   | 联调：OBS 导出文件 → OBS 手动导入验证                   | 测试        | 1h   | MP-08        |
| QA-06   | 联调：推流状态轮询 → 状态横幅实时更新                   | 前端+测试   | 1h   | BE-05, FE-06 |
| QA-07   | 联调：Reset Stream Key → OBS 旧配置失效 + 新 Key 生效   | 前后端      | 1h   | BE-03, MP-03 |
| QA-08   | 异常测试：SRS 不可达 → error 状态正确展示               | 测试        | 0.5h | QA-03        |
| QA-09   | 异常测试：OBS WebSocket 密码错误 → 友好提示             | 测试        | 0.5h | QA-04        |
| QA-10   | 全流程回归 + `npm run verify` 零错误确认                | 所有人      | 1h   | QA-01~QA-09  |

---

## 三、IPC 接口契约表（前端 ↔ 主进程唯一约定）

> **此表为前后端 + 主进程三方的最终接口契约，任何一方修改须先通知其他方并更新本表。**

| IPC 频道名称           | 前端调用方式                                      | 主进程 Handler 名 | 返回类型                                                      |
| ---------------------- | ------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| `stream:getConfig`     | `window.nekoIPC.getStreamConfig()`                | `ipcMain.handle`  | `StreamConfig` 对象                                           |
| `stream:saveConfig`    | `window.nekoIPC.saveStreamConfig(cfg)`            | `ipcMain.handle`  | `{ ok: true }`                                                |
| `stream:getKey`        | `window.nekoIPC.getStreamKey()`                   | `ipcMain.handle`  | `{ stream_key: string }`                                      |
| `stream:resetKey`      | `window.nekoIPC.resetStreamKey()`                 | `ipcMain.handle`  | `{ stream_key: string }`（新 Key）                            |
| `stream:getLiveStatus` | `window.nekoIPC.getStreamLiveStatus()`            | `ipcMain.handle`  | `'live' \| 'idle' \| 'error'`                                 |
| `stream:testSrs`       | `window.nekoIPC.testSrsConnection(config)`        | `ipcMain.handle`  | `{ ok, srsVersion?, rtmp_reachable, api_reachable, reason? }` |
| `stream:testObsWs`     | `window.nekoIPC.testObsWebSocket(wsConfig)`       | `ipcMain.handle`  | `{ connected, obsVersion?, reason? }`                         |
| `stream:applyToObs`    | `window.nekoIPC.applyStreamConfigToObs(wsConfig)` | `ipcMain.handle`  | `{ ok, error? }`                                              |
| `stream:exportConfig`  | `window.nekoIPC.exportObsServiceConfig()`         | `ipcMain.handle`  | `savedPath: string`（文件绝对路径）                           |

---

## 四、Mock 数据规范（联调前使用）

前端开发阶段，在 `app-ipc.js` 中先使用以下 Mock 实现，联调阶段替换为真实 IPC 调用：

```javascript
// ===== MOCK IPC（开发阶段使用，联调前删除）=====
window.nekoIPC = {
  ...window.nekoIPC,
  getStreamConfig: async () => ({
    srsHost: "192.168.1.100",
    srsRtmpPort: 1935,
    srsApp: "live",
    srsApiPort: 1985,
    streamKey: "nk_devtest1_ab12cd34",
    obsWsHost: "127.0.0.1",
    obsWsPort: 4455,
    obsWsPassword: "",
  }),
  resetStreamKey: async () => ({ stream_key: "nk_devtest1_ff00ee11" }),
  getStreamLiveStatus: async () => "idle",
  testSrsConnection: async () => ({
    ok: true,
    srsVersion: "5.0.200",
    rtmp_reachable: true,
    api_reachable: true,
  }),
  testObsWebSocket: async () => ({ connected: true, obsVersion: "30.1.2" }),
  applyStreamConfigToObs: async () => ({ ok: true }),
  exportObsServiceConfig: async () =>
    "C:\\Users\\Demo\\Desktop\\neko-obs-stream-config.json",
};
// ===== END MOCK =====
```

> ⚠️ **联调开始前必须删除 Mock 代码**，不允许将 Mock 提交至主分支。

---

## 五、版本发布决策

按照《RELEASE_WORKFLOW.md》规范执行：

| 里程碑                           | 触发条件                                       | 发布版本                       |
| -------------------------------- | ---------------------------------------------- | ------------------------------ |
| 前端 UI 静态完成 + Mock 自测通过 | FE-01 ～ FE-09 全部完成，`npm run verify` 通过 | 内部 nightly 构建              |
| 前后端联调全通过（QA-01~QA-10）  | 所有联调测试项 ✅                              | `v1.1.0-beta.1`（Pre-Release） |
| Beta 内测反馈修复完毕            | 无 P0/P1 缺陷未关闭                            | `v1.1.0-beta.2` 或直接升正式   |
| 正式上线                         | Beta 阶段无重大问题，产品经理确认              | `v1.1.0`（正式 Release）       |

---

## 六、上线前检查清单（Release Gate）

**前端**

- [ ] `npm run verify` 零错误
- [ ] 无硬编码颜色/尺寸（全部使用 CSS 变量）
- [ ] Mock IPC 代码已全部删除
- [ ] 推流状态轮询在页面切离后正确清除（`clearInterval`）
- [ ] OBS WebSocket 连接在应用退出时正确关闭（`obs.disconnect()`）

**后端**

- [ ] 数据库迁移脚本已测试（全新安装 + 升级路径）
- [ ] Stream Key 生成使用 `crypto.randomBytes()`
- [ ] 日志中无 Stream Key 明文
- [ ] 接口文档《02_REST_API接口文档.md》已更新

**主进程**

- [ ] `obs-websocket-js` 已加入 `package.json` dependencies
- [ ] `ConfigStore` 新字段有默认值且向下兼容旧配置格式
- [ ] OBS WebSocket 密码使用 `safeStorage` 加密存储
- [ ] 所有 IPC Handler 注册完整，无遗漏

**集成**

- [ ] 在真实 OBS + SRS 环境完成端到端推流测试
- [ ] 异常路径（SRS 不可达、OBS 密码错误、Key 重置）均有友好提示，无 crash
- [ ] Release Notes 包含「新功能：SRS 直播推流」条目

---

## 七、问题升级流程

开发过程中遇到以下情况，须立即同步开发经理：

1. IPC 接口契约需要变更（影响前端或主进程双方）
2. OBS WebSocket 协议不兼容（OBS 版本差异导致）
3. SRS HTTP API 格式与预期不符
4. 联调阶段发现安全漏洞

---

_文档责任人：开发经理 | 本文档为功能交付的最终依据，贯穿整个开发、联调和发布周期_
