# SRS 直播推流功能 — 前端 UI/UX 设计规范

> **文档角色**：开发经理 → 前端 UIUX 负责人  
> **版本**：v1.0 | **创建日期**：2026-04-06  
> **阅读对象**：负责 `index.html` / `main.css` / `app.js` / `app-ipc.js` 的前端开发人员  
> **前置依赖**：须先阅读《开发规范与工作流.md》，遵守三层职责分工

---

## 一、任务总览

你负责完成 **SRS 直播推流** 功能的完整前端实现，包含：

1. 侧边栏新增「直播推流」导航入口
2. 新建 `page-stream` 页面（推流控制主界面）
3. 在设置页（`page-settings`）新增「直播推流配置」子区块
4. 推流状态实时展示（配合主进程 IPC 数据刷新）

---

## 二、新增导航入口

### 2.1 位置

在 `index.html` 侧边栏 `<nav class="sidebar">` 中，插入到「截图与活动」与「服务与自启动」之间：

```html
<a class="nav-item" data-target="page-stream">
  <i class="ph ph-broadcast"></i>直播推流
</a>
```

> 图标使用 Phosphor Icons `ph-broadcast`（已在项目中引入，无需额外加载）。

---

## 三、`page-stream` 页面设计

### 3.1 DOM 骨架（`index.html` 添加位置：在 `page-services` 节点之后）

```html
<!-- ========== 直播推流页 ========== -->
<div class="page" id="page-stream" style="display:none;">
  <div class="content-safe-area">
    <!-- 页头 -->
    <div class="page-header">
      <h2 class="page-title-text"><i class="ph ph-broadcast"></i> 直播推流</h2>
      <span class="page-subtitle">通过 SRS 服务器一键推流至 OBS</span>
    </div>

    <!-- 推流状态横幅 -->
    <div
      class="stream-status-banner"
      id="streamStatusBanner"
      data-status="idle"
    >
      <div class="stream-status-dot" id="streamStatusDot"></div>
      <span class="stream-status-label" id="streamStatusLabel">未推流</span>
      <span class="stream-status-duration" id="streamStatusDuration"></span>
    </div>

    <!-- 引导卡片（SRS 未配置时显示，已配置时隐藏） -->
    <div class="stream-card stream-guide-card" id="streamGuideCard">
      <div class="guide-icon"><i class="ph ph-broadcast"></i></div>
      <h3>开始使用直播推流</h3>
      <p>
        你还没有配置 SRS
        流媒体服务器。前往设置填写服务器地址后，即可自动生成专属推流链接。
      </p>
      <button class="btn-primary" id="goToStreamSettings">前往配置</button>
    </div>

    <!-- 推流主控区（SRS 已配置时显示） -->
    <div class="stream-main-area" id="streamMainArea" style="display:none;">
      <!-- 推流 URL 展示卡 -->
      <div class="stream-card" id="streamUrlCard">
        <div class="card-section-title">
          <i class="ph ph-link"></i> 推流地址
        </div>
        <div class="stream-url-row">
          <div class="stream-url-display" id="streamRtmpUrl">
            rtmp://your-srs-server/live/nk_dev_000_xxxxxxxx
          </div>
          <button class="icon-btn" id="copyRtmpUrlBtn" title="复制推流地址">
            <i class="ph ph-copy"></i>
          </button>
        </div>
        <div class="stream-key-row">
          <span class="label-muted">Stream Key：</span>
          <span class="stream-key-value" id="streamKeyDisplay"
            >nk_dev_000_xxxxxxxx</span
          >
          <button
            class="icon-btn icon-btn-sm"
            id="resetStreamKeyBtn"
            title="重置 Stream Key"
          >
            <i class="ph ph-arrows-clockwise"></i>
          </button>
        </div>
      </div>

      <!-- OBS 联动卡 -->
      <div class="stream-card" id="obsLinkCard">
        <div class="card-section-title">
          <i class="ph ph-monitor-play"></i> OBS 快速联动
        </div>

        <!-- OBS WebSocket 模式 -->
        <div class="obs-mode-section" id="obsModeWebsocket">
          <div class="obs-mode-indicator">
            <div
              class="obs-ws-status-dot"
              id="obsWsDot"
              data-connected="false"
            ></div>
            <span id="obsWsLabel">OBS WebSocket 未连接</span>
          </div>
          <p class="obs-hint">
            确保 OBS 已安装并开启 WebSocket 服务（OBS → 工具 → obs-websocket
            设置 → 启用）。
          </p>
          <div class="obs-ws-config-row">
            <input
              type="text"
              class="input-field input-sm"
              id="obsWsHost"
              placeholder="127.0.0.1"
              value="127.0.0.1"
            />
            <input
              type="number"
              class="input-field input-sm input-port"
              id="obsWsPort"
              placeholder="4455"
              value="4455"
            />
            <input
              type="password"
              class="input-field input-sm"
              id="obsWsPassword"
              placeholder="密码（可选）"
            />
          </div>
          <div class="obs-actions-row">
            <button class="btn-secondary" id="testObsWsBtn">
              <i class="ph ph-plug"></i> 测试连接
            </button>
            <button class="btn-primary" id="applyToObsBtn" disabled>
              <i class="ph ph-magic-wand"></i> 一键配置 OBS 推流
            </button>
          </div>
        </div>

        <!-- 分隔线 + 降级方案 -->
        <div class="obs-divider">
          <span>或者</span>
        </div>

        <!-- 文件导出降级模式 -->
        <div class="obs-mode-section" id="obsModeExport">
          <p class="obs-hint">
            无法使用 WebSocket？导出配置文件后在 OBS
            中手动导入（仅需操作一次）。
          </p>
          <button class="btn-secondary" id="exportObsConfigBtn">
            <i class="ph ph-download-simple"></i> 导出 OBS 服务配置文件
          </button>
        </div>
      </div>

      <!-- 推流操作说明折叠区 -->
      <div class="stream-card stream-help-card" id="streamHelpCard">
        <div class="stream-help-toggle" id="streamHelpToggle">
          <i class="ph ph-question"></i> 如何使用 OBS 推流？
          <i class="ph ph-caret-down" id="streamHelpCaret"></i>
        </div>
        <div
          class="stream-help-content"
          id="streamHelpContent"
          style="display:none;"
        >
          <ol class="help-steps">
            <li>确保 SRS 服务器已启动（可在上方「测试连通性」验证）</li>
            <li>点击「一键配置 OBS 推流」，等待提示「OBS 已就绪」</li>
            <li>在 OBS 中点击「开始推流」，本页面状态将自动更新为「直播中」</li>
            <li>
              如 OBS WebSocket 不可用，导出配置文件后在 OBS「文件 → 导入」中载入
            </li>
          </ol>
        </div>
      </div>
    </div>
    <!-- /streamMainArea -->
  </div>
  <!-- /content-safe-area -->
</div>
<!-- /page-stream -->
```

---

## 四、设置页新增配置区块

在 `page-settings` 中，找到现有设置分组的末尾，追加以下区块（**不修改现有设置项**）：

```html
<!-- ========== 直播推流配置 ========== -->
<div class="settings-section" id="settings-stream">
  <div class="settings-section-title">
    <i class="ph ph-broadcast"></i> 直播推流
  </div>

  <div class="settings-item">
    <div class="settings-item-info">
      <span class="settings-item-label">SRS 服务器地址</span>
      <span class="settings-item-desc"
        >填写你的 SRS 服务器 IP 或域名（不含协议头）</span
      >
    </div>
    <input
      type="text"
      class="input-field"
      id="srsHost"
      placeholder="例：192.168.1.100 或 live.example.com"
    />
  </div>

  <div class="settings-item">
    <div class="settings-item-info">
      <span class="settings-item-label">RTMP 端口</span>
      <span class="settings-item-desc">SRS 默认监听端口为 1935</span>
    </div>
    <input
      type="number"
      class="input-field input-field-sm"
      id="srsRtmpPort"
      placeholder="1935"
      value="1935"
      min="1"
      max="65535"
    />
  </div>

  <div class="settings-item">
    <div class="settings-item-info">
      <span class="settings-item-label">应用名（App）</span>
      <span class="settings-item-desc">SRS 推流应用名，默认为 live</span>
    </div>
    <input
      type="text"
      class="input-field"
      id="srsApp"
      placeholder="live"
      value="live"
    />
  </div>

  <div class="settings-item">
    <div class="settings-item-info">
      <span class="settings-item-label">SRS HTTP API 端口</span>
      <span class="settings-item-desc">用于查询推流状态，SRS 默认为 1985</span>
    </div>
    <input
      type="number"
      class="input-field input-field-sm"
      id="srsApiPort"
      placeholder="1985"
      value="1985"
      min="1"
      max="65535"
    />
  </div>

  <div class="settings-item settings-item-actions">
    <button class="btn-secondary" id="testSrsConnectionBtn">
      <i class="ph ph-wifi-high"></i> 测试 SRS 连通性
    </button>
    <span class="test-result-label" id="srsTestResult"></span>
  </div>
</div>
```

---

## 五、CSS 规范

### 5.1 新增 CSS 变量（在 `:root {}` 补充）

```css
/* ===== SRS 直播推流 Design Tokens ===== */
--stream-online-color: #10b981; /* 直播中 - 绿色 */
--stream-idle-color: var(--text-dim); /* 未推流 - 暗色 */
--stream-error-color: #ef4444; /* 连接失败 - 红色 */
--stream-card-gap: 16px;
--obs-ws-connected: #10b981;
--obs-ws-disconnected: #6b7280;
```

### 5.2 页面专属样式（追加到 `main.css` 末尾）

```css
/* ========================================
   直播推流页 (page-stream)
   ======================================== */

/* --- 状态横幅 --- */
.stream-status-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: var(--radius-card);
  background: var(--glass-bg);
  border: 1px solid var(--border-subtle);
  margin-bottom: 20px;
  transition: border-color 0.3s;
}
.stream-status-banner[data-status="live"] {
  border-color: var(--stream-online-color);
  background: rgba(16, 185, 129, 0.06);
}
.stream-status-banner[data-status="error"] {
  border-color: var(--stream-error-color);
}
.stream-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--stream-idle-color);
  transition: background 0.3s;
  flex-shrink: 0;
}
.stream-status-banner[data-status="live"] .stream-status-dot {
  background: var(--stream-online-color);
  box-shadow: 0 0 8px var(--stream-online-color);
  animation: pulse-dot 1.5s infinite;
}
@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.stream-status-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-main);
}
.stream-status-duration {
  font-size: 12px;
  color: var(--text-dim);
  margin-left: auto;
}

/* --- 通用推流卡片 --- */
.stream-card {
  background: var(--glass-bg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  padding: 20px 24px;
  margin-bottom: var(--stream-card-gap);
}
.card-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* --- 推流 URL 展示 --- */
.stream-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.stream-url-display {
  flex: 1;
  font-family: var(--font-mono, "Consolas", monospace);
  font-size: 13px;
  color: var(--theme-color);
  background: rgba(0, 0, 0, 0.15);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}
.stream-key-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
}
.stream-key-value {
  font-family: var(--font-mono, "Consolas", monospace);
  color: var(--text-main);
  letter-spacing: 0.05em;
}

/* --- OBS 联动区 --- */
.obs-mode-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.obs-ws-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--obs-ws-disconnected);
  flex-shrink: 0;
  transition: background 0.3s;
}
.obs-ws-status-dot[data-connected="true"] {
  background: var(--obs-ws-connected);
  box-shadow: 0 0 6px var(--obs-ws-connected);
}
.obs-ws-config-row {
  display: flex;
  gap: 8px;
  margin: 12px 0;
  flex-wrap: wrap;
}
.input-port {
  width: 80px;
  flex-shrink: 0;
}
.obs-actions-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.obs-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0;
  color: var(--text-dim);
  font-size: 12px;
}
.obs-divider::before,
.obs-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}
.obs-hint {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.6;
  margin-bottom: 12px;
}

/* --- 帮助折叠区 --- */
.stream-help-card {
  cursor: default;
}
.stream-help-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;
}
.stream-help-toggle:hover {
  color: var(--text-main);
}
#streamHelpCaret {
  margin-left: auto;
  transition: transform 0.25s;
}
#streamHelpCaret.open {
  transform: rotate(180deg);
}
.stream-help-content {
  margin-top: 14px;
}
.help-steps {
  padding-left: 18px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.help-steps li {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
}

/* --- 引导卡片 --- */
.stream-guide-card {
  text-align: center;
  padding: 48px 24px;
}
.guide-icon {
  font-size: 48px;
  color: var(--text-dim);
  margin-bottom: 16px;
}
.stream-guide-card h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 8px;
}
.stream-guide-card p {
  font-size: 14px;
  color: var(--text-dim);
  line-height: 1.7;
  margin-bottom: 24px;
  max-width: 400px;
  margin-left: auto;
  margin-right: auto;
}

/* --- 测试结果标签 --- */
.test-result-label {
  font-size: 13px;
  margin-left: 8px;
}
.test-result-label.success {
  color: var(--stream-online-color);
}
.test-result-label.error {
  color: var(--stream-error-color);
}

.settings-item-actions {
  display: flex;
  align-items: center;
  padding-top: 4px;
}
```

---

## 六、JavaScript 行为规范（`app.js`）

### 6.1 路由注册

在现有 `navItems` 数组中追加：

```javascript
{ btnId: null, pageId: "page-stream", navSelector: '[data-target="page-stream"]' }
```

> 注意：按照项目规范，路由切换已通过 `data-target` 属性统一处理，确认现有通用路由逻辑覆盖到新页面即可。

### 6.2 页面初始化逻辑（在 `app.js` 中新增 `initStreamPage()` 函数）

```javascript
// ===== 直播推流页初始化 =====
function initStreamPage() {
  // 1. 从 IPC 读取 SRS 配置，判断是否显示引导卡片或主控区
  window.nekoIPC.getStreamConfig().then((config) => {
    const hasSrsConfig =
      config && config.srsHost && config.srsHost.trim() !== "";
    document.getElementById("streamGuideCard").style.display = hasSrsConfig
      ? "none"
      : "";
    document.getElementById("streamMainArea").style.display = hasSrsConfig
      ? ""
      : "none";
    if (hasSrsConfig) {
      renderStreamUrl(config);
      startStreamStatusPolling();
    }
  });

  // 2. 前往配置按钮
  document
    .getElementById("goToStreamSettings")
    .addEventListener("click", () => {
      navigateTo("page-settings");
      document
        .getElementById("settings-stream")
        .scrollIntoView({ behavior: "smooth" });
    });

  // 3. 复制 RTMP URL
  document.getElementById("copyRtmpUrlBtn").addEventListener("click", () => {
    const url = document.getElementById("streamRtmpUrl").textContent.trim();
    navigator.clipboard.writeText(url).then(() => {
      showNekoIsland("已复制推流地址", "success");
    });
  });

  // 4. 重置 Stream Key
  document.getElementById("resetStreamKeyBtn").addEventListener("click", () => {
    if (!confirm("重置后旧 Stream Key 立即失效，OBS 需重新配置。确认重置？"))
      return;
    window.nekoIPC.resetStreamKey().then((newKey) => {
      renderStreamKey(newKey);
      showNekoIsland("Stream Key 已重置", "warning");
    });
  });

  // 5. 测试 OBS WebSocket 连接
  document
    .getElementById("testObsWsBtn")
    .addEventListener("click", testObsWebSocket);

  // 6. 一键配置 OBS
  document
    .getElementById("applyToObsBtn")
    .addEventListener("click", applyStreamConfigToObs);

  // 7. 导出 OBS 配置文件
  document
    .getElementById("exportObsConfigBtn")
    .addEventListener("click", () => {
      window.nekoIPC.exportObsServiceConfig().then((savedPath) => {
        showNekoIsland(`已导出至：${savedPath}`, "success");
      });
    });

  // 8. 帮助折叠
  document.getElementById("streamHelpToggle").addEventListener("click", () => {
    const content = document.getElementById("streamHelpContent");
    const caret = document.getElementById("streamHelpCaret");
    const isOpen = content.style.display !== "none";
    content.style.display = isOpen ? "none" : "";
    caret.classList.toggle("open", !isOpen);
  });
}

function renderStreamUrl(config) {
  const key = config.streamKey || "";
  const url = `rtmp://${config.srsHost}:${config.srsRtmpPort || 1935}/${config.srsApp || "live"}/${key}`;
  document.getElementById("streamRtmpUrl").textContent = url;
  document.getElementById("streamKeyDisplay").textContent = key;
}

function renderStreamKey(newKey) {
  const config = /* 从 ConfigStore 读取 */ {};
  document.getElementById("streamKeyDisplay").textContent = newKey;
  // 重新拼合完整 URL
  renderStreamUrl({ ...config, streamKey: newKey });
}

let streamPollTimer = null;
function startStreamStatusPolling() {
  if (streamPollTimer) clearInterval(streamPollTimer);
  streamPollTimer = setInterval(() => {
    window.nekoIPC.getStreamLiveStatus().then((status) => {
      updateStreamStatusBanner(status);
    });
  }, 10000); // 10s 轮询，见产品需求非功能性要求
}

function updateStreamStatusBanner(status) {
  // status: 'live' | 'idle' | 'error'
  const banner = document.getElementById("streamStatusBanner");
  const label = document.getElementById("streamStatusLabel");
  const labels = { live: "直播中", idle: "未推流", error: "连接失败" };
  banner.dataset.status = status;
  label.textContent = labels[status] || "未知";
}

async function testObsWebSocket() {
  const host = document.getElementById("obsWsHost").value.trim();
  const port = document.getElementById("obsWsPort").value.trim();
  const pass = document.getElementById("obsWsPassword").value;
  const result = await window.nekoIPC.testObsWebSocket({
    host,
    port: Number(port),
    password: pass,
  });
  const dot = document.getElementById("obsWsDot");
  const lbl = document.getElementById("obsWsLabel");
  if (result.connected) {
    dot.dataset.connected = "true";
    lbl.textContent = `OBS WebSocket 已连接（v${result.obsVersion}）`;
    document.getElementById("applyToObsBtn").disabled = false;
  } else {
    dot.dataset.connected = "false";
    lbl.textContent = `连接失败：${result.reason}`;
    document.getElementById("applyToObsBtn").disabled = true;
  }
}

async function applyStreamConfigToObs() {
  const host = document.getElementById("obsWsHost").value.trim();
  const port = document.getElementById("obsWsPort").value.trim();
  const pass = document.getElementById("obsWsPassword").value;
  const result = await window.nekoIPC.applyStreamConfigToObs({
    host,
    port: Number(port),
    password: pass,
  });
  if (result.ok) {
    showNekoIsland("OBS 推流配置已写入，直接点击「开始推流」即可！", "success");
  } else {
    showNekoIsland(`写入失败：${result.error}，请尝试导出文件方式`, "error");
  }
}
```

### 6.3 设置页 SRS 配置保存（追加到设置页保存逻辑）

```javascript
// 在现有 saveSettings() 函数中追加 SRS 配置收集
function collectSrsSettings() {
  return {
    srsHost: document.getElementById("srsHost").value.trim(),
    srsRtmpPort: Number(document.getElementById("srsRtmpPort").value) || 1935,
    srsApp: document.getElementById("srsApp").value.trim() || "live",
    srsApiPort: Number(document.getElementById("srsApiPort").value) || 1985,
  };
}

// 测试按钮
document
  .getElementById("testSrsConnectionBtn")
  .addEventListener("click", async () => {
    const config = collectSrsSettings();
    const resultEl = document.getElementById("srsTestResult");
    resultEl.textContent = "测试中...";
    resultEl.className = "test-result-label";
    const result = await window.nekoIPC.testSrsConnection(config);
    if (result.ok) {
      resultEl.textContent = `✓ 连接成功（SRS v${result.srsVersion}）`;
      resultEl.className = "test-result-label success";
    } else {
      resultEl.textContent = `✗ 连接失败：${result.reason}`;
      resultEl.className = "test-result-label error";
    }
  });
```

---

## 七、IPC 接口约定（前端预期，由主进程实现）

前端通过 `window.nekoIPC` 调用如下方法（主进程端对接后端文档实现）：

| 方法名                             | 参数                       | 返回值                                                    | 说明                      |
| ---------------------------------- | -------------------------- | --------------------------------------------------------- | ------------------------- |
| `getStreamConfig()`                | 无                         | `{ srsHost, srsRtmpPort, srsApp, srsApiPort, streamKey }` | 读取当前 SRS 配置与 Key   |
| `saveStreamConfig(config)`         | `SrsConfig` 对象           | `{ ok: true }`                                            | 持久化 SRS 配置           |
| `resetStreamKey()`                 | 无                         | `newKey: string`                                          | 重置 Key，调用后端 API    |
| `getStreamLiveStatus()`            | 无                         | `'live' \| 'idle' \| 'error'`                             | SRS HTTP API 查询推流状态 |
| `testSrsConnection(config)`        | `SrsConfig`                | `{ ok, srsVersion?, reason? }`                            | 测试 SRS 连通性           |
| `testObsWebSocket(wsConfig)`       | `{ host, port, password }` | `{ connected, obsVersion?, reason? }`                     | 测试 OBS WebSocket        |
| `applyStreamConfigToObs(wsConfig)` | `{ host, port, password }` | `{ ok, error? }`                                          | 自动写入 OBS 推流配置     |
| `exportObsServiceConfig()`         | 无                         | `savedPath: string`                                       | 导出 obs-service.json     |

---

## 八、验收标准

- [ ] 侧边栏「直播推流」导航可正常切换到 `page-stream`
- [ ] SRS 未配置时展示引导卡片，「前往配置」按钮跳转设置页
- [ ] SRS 已配置时展示主控区，RTMP URL 拼合正确（含 Stream Key）
- [ ] 复制按钮触发 Island 提示动画
- [ ] 重置 Key 调用确认弹窗，确认后 URL 同步更新
- [ ] OBS WebSocket 测试成功后「一键配置」按钮激活
- [ ] `data-status="live"` 时状态点呈现绿色脉冲动画
- [ ] 帮助折叠展开动画正常，Caret 图标旋转
- [ ] 所有颜色使用 CSS 变量，无硬编码
- [ ] `npm run verify` 通过

---

_文档责任人：开发经理 | 下发对象：前端 UIUX 开发人员_
