# 大模型接入规划文档

> 状态：讨论稿  
> 负责人视角：产品经理  
> 创建日期：2026-06-09  
> 适用项目：Neko Status Desktop

## 文档目的

本目录用于沉淀 Neko Status 接入大模型能力的产品规划、需求边界、开发方案、安全约束、测试验收和发布回滚策略。当前版本是供负责人评审的第一版讨论稿，不代表已经进入开发。

## 阅读依据

本次规划已参考以下现有文档和代码结构：

- `docs/architecture.md`：Electron 四层架构、主进程本地后端、preload 安全桥、renderer service/page 分层。
- `docs/project-status.md`：当前工程达成度、renderer 拆分状态、更新模块现状。
- `docs/feature-evaluation-guide.md`：新功能立项、范围、风险、任务拆解和验收标准。
- `docs/feature-lifecycle.md`：新增 IPC、配置、页面、后台服务、开发者控制台命令的流程。
- `docs/frontend-backend-integration-guardrails.md`：IPC 返回结构、后台循环、条件 UI、性能和桥接防错清单。
- `docs/testing-guideline.md`：单测、renderer VM、Electron smoke、verify 与打包验证要求。
- `docs/developer-console.md`：白名单命令模型和联调入口规范。
- `docs/Tauri重构/01_项目总览与技术选型.md`：现有 Electron 资源占用问题和 v2 轻量化目标。
- `docs/Tauri重构/02_后端架构设计规范.md`：异步优先、结构化错误、服务层隔离等原则，可作为后续迁移参考。
- `src/shared/ipc-contracts.js`、`src/main/api-service.js`、`src/main/status-service.js`、`src/main/config-store.helpers.js`：现有 IPC、网络、上报和配置落点。

## 推荐结论

第一期建议做 **云端大模型诊断助手 MVP**：

- 用户主动触发，不做后台常驻分析。
- 只读诊断和建议，不自动执行修复、不拼接 Shell、不改配置。
- 主进程统一调用模型服务，renderer 不直接持有模型密钥。
- 默认不上传截图原图，不上传完整窗口标题和敏感 token。
- 提供发送前上下文预览、脱敏、取消、超时、限流和失败原因。
- 先以开发者控制台和诊断面板为入口，等稳定后再扩到普通用户首页。

暂不建议第一期做本地大模型常驻推理。原因是现有性能文档已经明确 Electron v1 常驻内存偏高，v2 目标是轻量化；本地模型会显著增加包体、内存、启动时间和显卡/CPU 负担，也会放大排障复杂度。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| `00_规划讨论稿.md` | PM 讨论稿、推荐路径、待负责人决策事项 |
| `01_产品需求文档.md` | 功能目标、范围、用户故事、交互状态和验收标准 |
| `02_开发方案与任务拆解.md` | 技术架构、IPC/配置/模块落点、数据结构和开发任务 |
| `03_数据隐私与安全边界.md` | 可发送数据、禁止发送数据、脱敏、密钥和审计规则 |
| `04_验收测试与发布计划.md` | 自动化测试、手工验收、发布、回滚和风险清单 |

## 待拍板事项

1. 第一阶段是否按“云端 LLM 诊断助手 MVP”推进。
2. 模型调用是否走服务端代理，还是允许用户配置自己的兼容 API endpoint。
3. 是否允许发送窗口标题、最近日志和更新源 URL；默认建议全部可预览、可取消、敏感字段自动脱敏。
4. 目标版本和优先级：建议 P1，目标下一个 minor 版本。
5. 是否把入口放在“开发者控制台 + 设备状态诊断面板”，还是直接新增侧边栏页面。

