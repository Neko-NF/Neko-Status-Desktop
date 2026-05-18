# Renderer 前端开发规范

本文说明 renderer 侧代码如何组织、如何访问 IPC、如何拆分页面与样式。目标是让前端改动可以多人并行，而不是继续把逻辑堆进 `app.js` 或 `app-ipc.js`。

## 基本原则

- 不引入新的大型前端框架，继续使用原生 HTML/CSS/JavaScript。
- 页面层只处理 DOM、交互和渲染。
- IPC 调用统一放在 `src/renderer/js/services`。
- 可复用 UI 行为放在 `components`。
- 跨页面基础能力放在 `core` 和 `state`。
- 新功能不写回 `app.js`；旧兼容逻辑逐步迁出。

## 目录职责

```text
src/renderer/js/
  app.js                 启动装配和历史兼容入口
  app-ipc.js             主进程事件协调和迁移中的兼容绑定
  ipc-bridge.js          preload 缺失时的降级兜底
  core/
    event-bus.js         轻量事件总线
    router.js            页面路由和导航状态
    theme.js             主题、色彩、字体 profile
  services/
    ipc-client.js        IPC 基础 client
    *.js                 领域 client
  components/
    *.js                 可复用 UI/命令组件
  state/
    app-state.js         全局状态容器
  pages/
    *.page.js            页面级 DOM 和交互
```

## 页面模块规则

页面模块放在 `src/renderer/js/pages`，命名为 `<name>.page.js`。典型结构：

```js
(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const PageName = {
    init(deps = {}) {
      if (this._inited) return;
      this._inited = true;
      this.bindEvents(deps);
    },

    bindEvents(deps) {},
    render(data) {},
  };

  window._nekoModules.pages.PageName = PageName;
})();
```

要求：

- `init()` 必须幂等，防止重复绑定事件。
- 页面可以接收依赖注入，例如 `notify`、`addLogLine`、`showNotice`。
- 页面不直接访问 Node/Electron 能力。
- 页面不拼接 IPC channel 字符串。
- 页面需要配置或系统能力时，调用 `services/*` 或由 `app-ipc.js` 注入回调。

## Renderer service 规则

Service 放在 `src/renderer/js/services`。它们负责把 UI 语义映射到 preload 暴露方法。

当前服务：

```text
ipc-client.js
api-client.js
config-client.js
auth-client.js
service-client.js
system-client.js
stream-client.js
update-client.js
```

新增规则：

- 页面需要新 IPC 能力时，先补 service 方法。
- service 方法使用业务命名，例如 `setDashboardLayout()`，不要把 preload 方法名泄漏给页面。
- service 不缓存旧 bridge；`IpcClient` 在调用时读取 `window.nekoIPC`。
- service 变更必须补 VM 测试。

## 组件规则

组件放在 `src/renderer/js/components`。

适合组件化的内容：

- 通知、弹窗、折叠区、命令注册器。
- 可复用 DOM 行为。
- 页面间共享的 UI helper。

不适合组件化的内容：

- 只属于单个页面的一段表单逻辑。
- 强依赖具体页面 ID 的大段业务流程。
- 直接访问 IPC 的逻辑。

## 样式分层

样式加载顺序：

```text
tokens.css
base.css
layout.css
components.css
pages.css
legacy.css
```

职责：

- `tokens.css`：颜色、尺寸、阴影、字体变量。
- `base.css`：全局 reset、body、基础元素。
- `layout.css`：整体布局、侧边栏、主内容结构。
- `components.css`：按钮、弹窗、开关、通知、可复用组件。
- `pages.css`：页面专属区块，如 dashboard、settings、stream、update。
- `legacy.css`：迁移期保留样式，后续逐步归并。
- `main.css`：只作为入口，不再承接新样式。

新增样式时先判断是组件还是页面。不要把新样式继续堆进 `main.css`。

## 导航与条件入口

侧边栏入口可能受配置、实验开关或权限控制。实现要求：

- 隐藏状态不能留下空白间距。
- 需要动画时使用状态类，不依赖 `display:none`。
- 隐藏 active 页面前，先导航到稳定页面。
- 状态变化后同步导航指示器。
- 新入口必须在移动窗口、缩放、主题切换下检查布局。

## 安全与 DOM

- 不在 renderer 直接 `require('electron')`。
- 不在 renderer 直接使用 `process`、`fs`、`ipcRenderer`。
- 用户输入必须用 `textContent` 或统一 escape 后再插入。
- 避免把用户输入拼入 `innerHTML`。
- 外部链接通过 `SystemClient.openExternal()`，不直接调用 shell。

## 当前已迁移页面

| 模块 | 职责 |
| --- | --- |
| `auth.page.js` | 登录、注册、首次引导、个人资料、头像编辑 |
| `config.page.js` | 服务器配置弹窗、连接测试、设备密钥校验 |
| `dashboard.page.js` | 仪表盘布局编辑、卡片拖拽、尺寸调整 |
| `device-status.page.js` | 设备状态 KPI、诊断、指标推送渲染 |
| `screenshot.page.js` | 截图与活动页、隐私规则、窗口选择器 |
| `settings.page.js` | 字体选择与设置页局部行为 |
| `stream.page.js` | 推流配置、SRS/OBS 测试、直播状态 |
| `update.page.js` | 更新弹窗、徽章、更新页面展示 |

## 新页面验收清单

- 已加入 `src/renderer/index.html`，加载顺序正确。
- 已加入 `scripts/verify.js` 的结构和语法检查。
- 页面 `init()` 幂等。
- 页面不直接访问 `window.nekoIPC`。
- IPC 调用通过 service。
- 至少有 VM 单测或明确手工验收路径。
- 样式放入正确 CSS 层。
