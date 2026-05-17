# 前端开发规范

## 当前原则

- 不引入新的大型前端框架
- 继续使用原生 HTML/CSS/JS
- 通过 preload 访问主进程，不直接访问 Electron API

## 目录演进方向

当前仍以 `app.js` 和 `app-ipc.js` 为主，但新代码应优先向以下结构靠拢：

```text
src/renderer/js/
  pages/
  services/
  state/
  components/
```

当前已落地的第一阶段组件化文件：

- `src/renderer/js/components/ui-helpers.js`：通用 UI helper，提供折叠动画、字体 profile 和服务体检文案标准化。
- `app.js` 仍保留旧 helper 作为兜底，但新代码应优先复用 `window._nekoUIHelpers`，不要在页面脚本中再次复制同类 DOM 动画或字体 profile 逻辑。
- `src/renderer/js/core/*`：承接 event bus、主题与路由基础设施；新入口优先复用这些模块，不再把全局流程继续写回 `app.js`。
- `src/renderer/js/pages/*`：页面级迁移落点。`stream.page.js` 已经承接直播推流页的真实业务逻辑；`dashboard.page.js` 和 `settings.page.js` 仍是后续迁移骨架。
- `src/renderer/js/state/app-state.js`：全局状态容器的迁移起点，新增跨页面状态时优先放这里或新增同级 state 文件。

## 页面规则

- 页面负责 DOM 查询、事件绑定、渲染入口
- 不在页面层直接写复杂 IPC 协议细节
- 不在页面层维护多份来源不一致的状态

## 样式规则

- 样式按 `tokens.css -> base.css -> layout.css -> components.css -> pages.css -> legacy.css` 分层加载。
- `main.css` 只作为兼容入口和路由文件，原则上不要继续把新样式堆回 `main.css`。
- 通用控件、弹窗、按钮、通知等放入 `components.css`；页面专属的 dashboard/settings/stream/update/auth 等放入 `pages.css` 或后续更细的页面样式文件。
- 避免继续扩散内联样式

## 侧边栏条件入口与动画规则

侧边栏入口如果只在特定配置、实验开关或权限状态下显示，必须按“条件型导航入口”实现：

- 入口 DOM 可以常驻，但隐藏态不得占据导航列表间距；隐藏项要把 `max-height`、上下 `padding`、上下 `margin`、`opacity` 和 `visibility` 一起收起。
- 导航列表不要依赖 `gap` 表达可见项间距；使用可动画的 `margin-bottom`，隐藏项收起时将 `margin-bottom` 归零，避免不可见入口留下空洞。
- 不要用 `display:none` 作为默认隐藏方案，除非明确不需要展开/收起动画；需要动画时使用 `.show` 状态类控制显隐。
- 条件入口展开或收起后，必须重新同步 `.nav-active-indicator` 的位置。当前兼容入口为 `window._nekoSyncNavIndicator?.()`，调用点应放在状态类切换之后。
- 如果隐藏入口正处于 active 状态而即将被关闭，必须先导航到稳定页面，再收起入口，避免蓝色遮罩停在不可见项位置。
- 新增侧边栏入口时，需要同时检查 hover 白色遮罩与 active 蓝色遮罩的 `min-height`、圆角和左右边界是否一致。

## 安全规则

- 不新增 renderer 直接 `require('electron')`
- 动态 HTML 尽量避免直接拼接 `innerHTML`
- 涉及用户输入的内容需要显式转义或文本化插入
# 2026-05 Renderer service 分层补充

- `src/renderer/js/services/ipc-client.js` 是 renderer IPC 调用基础封装，必须运行时读取 `window.nekoIPC`，不要缓存旧 bridge。
- `src/renderer/js/services/stream-client.js` 已承接直播推流页 IPC 调用，`stream.page.js` 只负责 DOM、状态展示和用户事件。
- `settings.page.js` 已承接设置页字体选择器；后续设置页区块迁移时沿用“一块 UI + 一个明确 service/client 依赖”的方式。
- 新页面代码优先调用 `services/*`，不要在 page 中直接拼 IPC channel，也不要继续把新业务逻辑写回 `app.js`。
