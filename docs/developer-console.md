# Developer Console Guideline

开发者控制台是面向本地排障、演示验证和开发联调的受控诊断入口，不是任意脚本执行环境。控制台命令必须走白名单注册，不允许把用户输入拼接成 JavaScript、Shell、PowerShell 或 IPC channel。

## 代码落点

- `src/renderer/js/components/developer-console.js`
  - 负责命令注册、别名、参数拆分、帮助输出和统一错误处理。
  - 暴露 `window._nekoModules.components.DeveloperConsole.createCommandRegistry()`。
- `src/renderer/js/app-ipc.js`
  - 负责注入真实 IPC、日志输出函数和页面状态 helper。
  - 不再直接维护长串 `if/else` 命令分支。
- `src/renderer/index.html`
  - 必须在 `app-ipc.js` 之前加载 `components/developer-console.js`。

## 命令设计规则

- 命令名使用小写英文，按领域分组：`service start`、`update check`、`config get <key>`。
- 常用命令可以提供短别名，如 `start` 等价于 `service start`。
- 每个命令必须包含 `description`，需要参数时必须包含 `usage`。
- 命令只能调用 preload 暴露的安全 IPC 方法，不能直接访问 Node/Electron。
- 命令输出必须使用 `addLogLine(level, message)`，避免直接写 DOM。
- 用户输入参数必须当作普通字符串处理；涉及 HTML 的输出必须由日志层转义。
- 破坏性命令默认不加入控制台；确需加入时必须二次确认，并在文档说明风险。

## 当前命令

| 命令 | 别名 | 说明 |
| --- | --- | --- |
| `help [command]` | `?` | 查看命令列表或单个命令详情 |
| `clear` | `cls` | 清空控制台输出 |
| `version` | `ver` | 输出应用版本 |
| `status` |  | 刷新 Runtime、Service、Cache、Metrics 状态卡 |
| `health` |  | 运行服务和环境体检 |
| `metrics` | `metric` | 输出当前 CPU / Memory 指标 |
| `cache` |  | 输出本地缓存大小 |
| `cache clear` | `clear-cache` | 调用主进程清理本地缓存 |
| `last` |  | 输出最近一次上报结果 |
| `config` |  | 输出当前配置快照 |
| `config get <key>` | `get` | 输出单个配置项 |
| `service start` | `start` | 启动上报服务 |
| `service stop` | `stop` | 停止上报服务 |
| `service restart` | `restart` | 重启上报服务 |
| `service status` | `running` | 输出上报服务运行状态 |
| `capture` | `screenshot` | 触发一次截图 |
| `update check` | `update` | 检查更新 |
| `update pending` |  | 查看待安装更新包状态 |
| `update integrity` |  | 运行更新系统完整性检查 |

## 新增命令流程

1. 在 `developer-console.js` 中通过 `register({ name, aliases, usage, description, run })` 增加命令。
2. 如果命令需要后端能力，优先复用 `ipc` 里已有 preload 方法；没有方法时先补 IPC 契约、preload 和主进程 handler。
3. 如果命令需要更新页面状态，通过 `helpers` 注入已有 UI helper，不要在命令模块里直接查询复杂 DOM。
4. 在 `tests/unit/renderer-services.test.js` 增加命令解析或委派测试。
5. 更新本文档的命令表。

## 输出规范

- `INFO`：普通状态、快照、用户主动查询结果。
- `SUCCESS`：操作成功且产生状态变化。
- `WARN`：可恢复问题、配置缺失、非阻塞异常。
- `ERROR`：命令失败、IPC 缺失、主进程返回错误。

控制台最多保留 500 行日志，导出由主进程 `dialog:saveTextFile` 能力完成。
