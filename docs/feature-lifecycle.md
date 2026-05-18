# 功能生命周期规范

本文定义一个功能从提出、实现、测试、发布到废弃的完整流程。目标是避免功能只在某个文件里“能跑”，却缺少契约、测试和团队可维护性。

## 新增功能

新增功能前先回答：

- 用户目标是什么？
- 是否需要后端 API？
- 是否需要主进程系统能力？
- 是否需要 IPC？
- 是否需要配置项？
- 是否需要新页面、组件或样式？
- 如何测试？
- 如何回滚？

推荐流程：

1. 创建 issue 或任务描述，写清验收标准。
2. 明确代码落点。
3. 如需 IPC，先更新 `src/shared/ipc-contracts.js` 和 `schemas.js`。
4. 实现主进程 service/system/ipc。
5. 实现 preload 暴露方法。
6. 实现 renderer service。
7. 实现 page/component/state。
8. 补测试。
9. 更新 docs。
10. 提交 PR。

## 修改功能

先区分修改类型：

- 行为变更：用户可感知，必须更新测试和文档。
- 重构：行为不变，重点保证回归测试。
- 兼容修复：必须说明旧行为和兼容窗口。

涉及 IPC 或配置时，优先保持兼容。确实需要破坏兼容时，PR 必须说明迁移方式。

## 删除功能

删除前检查：

- 是否仍有 UI 入口？
- 是否仍有配置项？
- 是否仍有 IPC channel？
- 是否仍有定时任务、事件监听或后台服务依赖？
- 是否有测试或文档引用？
- 是否需要迁移旧配置？

删除流程：

1. 移除 UI 入口。
2. 替换或停用调用方。
3. 删除 renderer service 方法。
4. 删除 preload 暴露方法。
5. 删除主进程 handler。
6. 删除 IPC 常量和 schema。
7. 清理配置默认值或提供迁移。
8. 更新测试和文档。

## 新增 IPC

遵循 `docs/ipc-contract.md`。简要流程：

1. `src/shared/ipc-contracts.js` 增加 channel/event。
2. `src/shared/schemas.js` 增加 payload 校验。
3. `src/main/ipc/*.ipc.js` 注册 handler。
4. `src/preload/index.js` 暴露最小方法。
5. `src/renderer/js/services/*` 增加业务方法。
6. 页面调用 service。
7. 补 IPC 单测、renderer service 测试、文档。

## 废弃 IPC

1. 文档标记废弃和替代接口。
2. 迁移 renderer service。
3. 迁移页面调用。
4. 保留必要兼容 alias。
5. 删除旧 handler 和 preload 方法。
6. 删除常量。
7. 补测试确保旧路径不再被使用。

## 新增配置项

配置项必须同步：

- `src/main/config-store.helpers.js` 默认值。
- 读取和写入逻辑。
- 如果通过 IPC 修改，补 config schema。
- UI 默认状态。
- 测试。
- 文档。

配置命名要求：

- 使用清晰业务含义。
- 避免 UI 控件名。
- 布尔值使用 `enable*`、`*Enabled` 或明确语义。
- 废弃配置必须保留迁移逻辑或清理说明。

## 新增 UI 页面

流程：

1. 在 `src/renderer/js/pages/<name>.page.js` 新建页面模块。
2. 在 `src/renderer/index.html` 按依赖顺序加载。
3. 如需导航入口，更新 HTML、路由和样式。
4. IPC 调用放入 `services/*`。
5. 页面样式放入 `pages.css` 或后续页面样式文件。
6. 在 `scripts/verify.js` 加入文件结构和语法检查。
7. 补页面 VM 测试或手工验收步骤。

页面模块必须幂等初始化，避免重复绑定事件。

## 新增后台服务

后台服务应放在 `src/main` 的 service 文件中，或扩展已有 service。需要明确：

- 配置来源。
- 启动/停止方式。
- 错误处理和重试策略。
- 日志出口。
- IPC 控制入口。
- 测试路径。

不要把后台服务逻辑写进 `main.js` 或 IPC handler。IPC handler 只负责校验、调用服务、包装返回。

## 新增系统能力

系统能力包括截图、窗口枚举、缓存、通知、文件选择、开机自启、焦点辅助等。

要求：

- 放在 `system-utils.js` 或对应系统模块。
- 明确 Windows 限制。
- 提供失败回退路径。
- 主进程捕获异常并返回结构化错误。
- Renderer 展示用户可理解的失败原因。

## 新增开发者控制台命令

开发者控制台不是任意脚本执行器。新增命令流程：

1. 在 `src/renderer/js/components/developer-console.js` 注册命令。
2. 命令只能使用注入的 `ipc` 和 `helpers`。
3. 需要后端能力时，先补 renderer service / preload / IPC。
4. 更新 `docs/developer-console.md`。
5. 在 `tests/unit/renderer-services.test.js` 覆盖解析、别名或 handler 委托。

禁止把用户输入拼成 JavaScript、Shell、PowerShell 或动态 IPC channel。

## 文档同步要求

以下变化必须更新文档：

- 新增或废弃 IPC。
- 新增配置项。
- 新增页面或服务。
- 新增测试命令。
- 发布流程变化。
- 安全边界变化。
- 需要团队共同遵守的新约束。

文档应写稳定规则，不写“今天做了什么”。阶段性记录放 PR 描述或 changelog，不放核心规范文档。

## PR 验收

最低要求：

- `npm run verify` 通过。
- 相关单测通过。
- 涉及 Electron/preload/IPC 时 `npm run test:smoke` 通过。
- 涉及打包时 `npm run build:zip` 通过。
- PR 描述写清行为变化、测试结果和风险。
