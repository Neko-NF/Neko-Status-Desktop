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

## 页面规则

- 页面负责 DOM 查询、事件绑定、渲染入口
- 不在页面层直接写复杂 IPC 协议细节
- 不在页面层维护多份来源不一致的状态

## 样式规则

- 公共样式继续集中在 `main.css`
- 新增页面时优先按页面区块组织注释和样式段落
- 避免继续扩散内联样式

## 安全规则

- 不新增 renderer 直接 `require('electron')`
- 动态 HTML 尽量避免直接拼接 `innerHTML`
- 涉及用户输入的内容需要显式转义或文本化插入
