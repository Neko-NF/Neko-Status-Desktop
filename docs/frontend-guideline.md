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
  app.js                 瘦身后的启动装配入口
  app-ipc.js             兼容启动器，启动 core/app-runtime.js
  ipc-bridge.js          preload 缺失时的降级兜底
  core/
    app-init-runtime.js  APP_INIT 启动态同步和跨页面初始 hydration
    app-event-runtime.js 主进程推送事件转发和跨页面实时联动
    app-runtime.js       renderer services/pages/components 运行时装配
    event-bus.js         轻量事件总线
    router.js            页面路由和导航状态
    theme.js             主题、色彩、字体 profile
  services/
    ipc-client.js        IPC 基础 client
    *.js                 领域 client
  components/
    app-shell-controls.js 顶栏、侧栏、全局控件和 shell 弹窗绑定
    console-runtime.js     控制台日志、状态卡、导出和命令输入装配
    experimental-features.js 实验性功能入口挂载与显隐状态
    loading-curves.js      数学曲线注册表与纯采样逻辑
    loading-system.js      加载实例、按钮 busy 与共享动画调度器
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
- 页面需要配置或系统能力时，调用 `services/*` 或由 `core/app-runtime.js` 注入回调。

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
- 控制台这类跨页面调试工具的运行时装配，必须通过依赖注入访问 services。
- 实验性功能入口和显隐状态放在 `components/experimental-features.js`，不要散落到 `app-ipc.js`。
- 启动态跨页面 hydration 放在 `core/app-init-runtime.js`，不要回填到 `app-ipc.js`。
- 主进程推送事件放在 `core/app-event-runtime.js`，不要把新的 `ipcClient.on(...)` 直接写入 `app-ipc.js`。
- 跨模块依赖注入和 runtime 装配放在 `core/app-runtime.js`，不要把页面 DOM glue 写回 `app-ipc.js`。

不适合组件化的内容：

- 只属于单个页面的一段表单逻辑。
- 强依赖具体页面 ID 的大段业务流程。
- 直接访问 IPC 的逻辑。

## UIUX 创新与复用

团队成员可以在具体功能中引入新的视觉组件、交互形态或局部风格，但必须满足以下边界：

- 大体视觉气质仍与当前桌面工具一致：紧凑、清晰、可扫描，不做营销页式装饰。
- 新组件必须使用 `tokens.css` 的主题色、语义色、圆角、阴影和动效变量，不硬编码与主题冲突的主色。
- 新组件如果会被两个以上页面复用，应沉淀到 `components`；只服务单页的变体留在对应页面模块和 `pages.css`。
- 新组件必须定义清楚空态、加载态、成功态、失败态、禁用态和浅色/深色主题表现。
- 可以有创新动画，但动画只服务状态识别和操作反馈，不做大面积扫光、强渐变、彩虹色或持续分散注意力的效果。
- 日期、筛选、步骤、开关、刷新、错误提示等高频控件应优先复用现有按钮、分段器、灵动岛、弹窗和表单结构。
- 涉及错误、失败、权限不足、保存失败、刷新失败等关键反馈时，页面内状态与醒目提示必须同时出现；可使用灵动岛、弹窗或明确的错误面板。

新增或重构 UI 时，需要在 PR 说明中写明：组件放置位置、是否可复用、主题适配方式、手工验收路径。

### 下拉组件

涉及触达范围、发布状态、通道、来源、分类等短选项时，优先使用可复用的 `neko-select` 自绘下拉。实现要求：

- 原生 `select` 可以作为数据源和表单值保留，但视觉层使用 `window._nekoUIHelpers.enhanceSelect()` 增强。
- 选项需要有文字和图标，当前值、hover、active、disabled 状态必须清楚。
- 下拉面板使用主题 token，不直接写死深色/浅色背景。
- 组件样式放在 `components.css`，页面只写局部尺寸或排列覆盖。
- 不用原生下拉外观作为正式 UI，除非是临时排障或系统级文件/目录选择。

## 样式分层

样式加载顺序：

```text
tokens.css
base.css
layout.css
legacy.css
loading-system.css
components.css
pages.css
```

职责：

- `tokens.css`：颜色、尺寸、阴影、字体变量。
- `base.css`：全局 reset、body、基础元素。
- `layout.css`：整体布局、侧边栏、主内容结构。
- `components.css`：按钮、弹窗、开关、通知、可复用组件。
- `pages.css`：页面专属区块，如 dashboard、settings、stream、update。
- `legacy.css`：迁移期保留样式，后续逐步归并。
- `loading-system.css`：全局加载反馈和紧凑 busy 的唯一动画来源。
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
| `dashboard.page.js` | 仪表盘布局编辑、卡片拖拽、尺寸调整、运行时卡片刷新、活动流、截图预览同步、趋势图与指标历史 |
| `device-status.page.js` | 设备状态 KPI、诊断、指标推送渲染、权限折叠、权限诊断按钮 |
| `screenshot.page.js` | 截图与活动页、截图控制、隐私规则、窗口选择器 |
| `settings.page.js` | 字体选择、核心设置开关、上报间隔、通知/勿扰、隐身范围、主题、缩放和缓存清理 |
| `service.page.js` | 上报服务、自启动、自动恢复和服务体检 |
| `stream.page.js` | 推流配置、SRS/OBS 测试、直播状态 |
| `update.page.js` | 更新弹窗、徽章、更新页面展示、更新通道、更新源控件、来源诊断、完整性检查、本地安装入口、下载/安装进度、手动检查、强制更新、待安装更新、版本回滚和更新日志渲染 |
| `announcement.page.js` | 公告管理、公告弹窗轮询、系统通知和回执状态 |
| `about.page.js` | 关于页版本、运行时、仓库链接和仓库元数据渲染 |
| `ui-lab.page.js` | UI 实验室曲线预览、场景切换、静态画廊和本地诊断 |

已迁移的跨页面组件还包括 `components/security-dialogs.js`，用于密钥接管、撤销和设备删除相关的安全弹窗。

## 新页面验收清单

- 已加入 `src/renderer/index.html`，加载顺序正确。
- 已加入 `scripts/verify.js` 的结构和语法检查。
- 页面 `init()` 幂等。
- 页面不直接访问 `window.nekoIPC`。
- IPC 调用通过 service。
- 至少有 VM 单测或明确手工验收路径。
- 样式放入正确 CSS 层。
- 涉及 UI 文案、按钮尺寸、卡片信息层级或昼夜主题时，同步遵循 [uiux-copywriting-guideline.md](./uiux-copywriting-guideline.md)。

## 数据管理页约束

面向公告管理、申请单、设备列表等高频扫描页面时，优先采用紧凑的数据工作台布局：

- 路由顶部已经展示页面名称时，页面内容区不要再次放置同级大标题。内容区可使用一句辅助说明、筛选条或统计摘要，避免“公告管理 / 公告管理”式重复。
- 页面主操作区应与筛选项同一行对齐；空间不足时整体换行，不要让按钮贴到底部或与说明文字挤在一起。
- 表格必须使用稳定列宽。列数量固定时优先使用 `table-layout: fixed` + `colgroup`，让表头与单元格共享宽度来源。
- 操作列必须固定宽度并右对齐。多个行内按钮使用独立 flex 容器控制 `gap`，不要依赖普通文本流自然换行。
- 表格行 hover 不得改变布局尺寸；禁止在数据表行上使用会造成表头/内容视觉错位的 scale/translate。
- 长标题、长内容、URL、路径等必须省略并提供 `title`，不得把操作列或状态列挤变形。
- 表单卡片和列表卡片之间保留稳定纵向间距，常规建议 20-24px；表单 footer 顶部间距不低于 16px。

## 加载反馈规范

加载反馈统一遵循 [数学曲线加载系统与 UI 实验室](./math-curve-loading-system.md) 的语义矩阵：非确定的大区域等待使用曲线，按钮使用紧凑 busy，结构化首屏使用骨架屏，可计算任务使用进度条，静默后台任务使用状态文字或徽章。

- 页面不得新增私有旋转 keyframes；兼容图标统一使用 `.ph-spin`，新按钮优先调用 `LoadingSystem.setButtonBusy()` 或 `UIHelpers.setButtonBusy()`。
- 曲线只服务加载状态，禁止作为常驻装饰、空态插图、成功动画或页面背景。
- 新预设必须注册到 `components/loading-curves.js`，不得在页面里临时写公式或 SVG path。
- 新预设必须声明用户可读用途和动效性格；不得默认套用匀速绕圈或整体旋转，除非加载语义需要。
- 所有加载状态必须有明确文字；动画 SVG 自身不承担语义。
- 必须支持 `prefers-reduced-motion`、forced colors、页面隐藏和元素离屏暂停。
- 正式页面同时活动实例不得超过 4，UI 实验室画廊只能有一个活动预览。
