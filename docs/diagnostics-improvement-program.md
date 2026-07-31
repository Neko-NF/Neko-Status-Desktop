# Neko Status 软件增强改进计划与诊断契约

本文件是桌面端、`neko-server` 与 Android 兼容实现的权威规范。当前 `diagnosticSchemaVersion = 1`，`consentPolicyVersion = 1`。服务端和 Android 仓库中的副本或接口说明必须与本文件保持兼容；发生冲突时，以本文件及同版本 golden schema 为准。

## 1. 授权和触发

总开关默认关闭。开启前必须展示授权版本、最大诊断范围、异常触发时机和保留期限。只允许以下异常触发：崩溃、未处理异常、渲染进程退出/加载失败、配置恢复、不可恢复认证错误、连续传输失败、关键更新失败。诊断上传与登录、状态上报、更新、退出生命周期完全隔离；失败不得改变核心功能状态。

在 v1 授权边界内，新增功能状态、日志、错误码和非敏感配置可随 schema 升级自动扩展。若新增截图、图像、文件内容、剪贴板内容、录音或个人资料等当前禁止类别，必须提升 `consentPolicyVersion`，将旧授权变为待重新确认，重新确认前不得采集或上传。

## 2. 数据分级与永久禁止项

- `operational`：版本、时间、服务状态、错误码、网络分类。
- `configuration`：不含凭据的功能开关、间隔和模式。
- `system`：操作系统、CPU、内存和进程摘要。
- `raw-diagnostic`：原始窗口标题、完整路径、应用/进程名、错误栈和最多 1000 条日志。仅在用户明确开启 v1 授权后允许。
- `prohibited`：截图或其他图像、文件/剪贴板内容、密码、Cookie、Authorization、任何 Token/设备密钥/直播密钥/更新密钥、头像、邮箱和账号资料原文。客户端和服务端必须各脱敏一次，普通 schema 升级不得解除。

当前最大诊断集为：原始窗口标题、完整路径、应用/进程名、错误栈、系统和硬件摘要、服务状态、网络分类、非敏感配置及最近最多 1000 条日志。最大范围不是每次报告都采集的固定字段集合，而是已授权的上界。

## 3. 信封、兼容和限额

固定信封包含 `reportId`、`diagnosticSchemaVersion`、`consentPolicyVersion`、`occurredAt`、`client`、`trigger`、`environment`、`featureSections` 和 `recentLogs`。`featureSections` 以稳定 `featureId` 为键。服务端必须保留未知未来段，同时执行通用脱敏、1 MiB 和段数量限制。客户端读取能力接口后按服务端 schema 上限降级；新增字段不得导致整个旧服务端请求失败。

单包最多 1 MiB；本地最多 20 包或 20 MiB，最长 14 天；同一客户端指纹 6 小时内合并。关闭开关立即停止采集并清空未上传队列。服务端原始脱敏报告保留至问题解决/忽略后 30 天，已解决/忽略的问题摘要保留 180 天；开放问题不按固定天数自动删除。

## 4. Schema 和授权版本升级

- 注册表字段、贡献结构或信封发生向后兼容扩展时，提升 `diagnosticSchemaVersion`，更新本规范、golden schema、测试样例和更新说明。
- 仅修正文案或不改变线上结构的实现修复可不提升 schema。
- 扩大到任何 `prohibited` 类别必须提升 `consentPolicyVersion`，旧授权全部待确认。
- 服务端能力接口必须返回 schema 上限、授权策略版本、大小/日志/段限制和未知功能段策略。

## 5. 功能交付门禁

每个新功能必须在 `docs/feature-diagnostics-manifest.json` 中登记其源文件，选择 `contribution` 或 `none`。贡献项必须注册稳定 `featureId`、贡献版本、状态/非敏感配置字段、错误事件/错误码/级别/触发器、字段类型、隐私等级、脱敏方式、单项大小上限、稳定指纹字段、测试和本规范章节。选择 `none` 必须写明理由。

注册表变化必须同步提升 schema 并更新本规范和 golden schema；新增敏感字段必须有显式分级与脱敏测试；文档章节必须存在；诊断失败不得阻塞功能本身。`npm run verify` 执行这些约束。

## 6. 聚合、解决、复发和 AI Agent 流程

服务端按功能、错误码、规范化消息、平台和主要栈帧生成指纹，状态为 `open / in_progress / resolved / ignored`。记录修复版本；已解决问题在等于或高于修复版本的客户端复发时自动重开，旧客户端复发只增加旧版计数。

开始新功能、修复或版本规划前，技术人员和 AI Agent 必须在部署服务器本机运行 `npm run diagnostics:issues -- list` 并记录纳入、延期和无关的问题 ID。可用命令为 `list/show/export/resolve/reopen/ignore/cleanup`，均输出 JSON。只有部署和回归验证成功后才可用 `resolve --fixed-in <version>`；无法访问服务器时必须记录“开放问题检查未完成”，不得假定没有问题。

## 7. 当前贡献

### 7.1 core.config

配置恢复来源、隔离数量与 `CONFIG_RECOVERED / CONFIG_UNRECOVERABLE`；不包含配置文件原文。

### 7.2 core.auth

会话状态、服务端模式与 `AUTH_SESSION_UNRECOVERABLE`；不包含账号资料和凭据。

### 7.3 core.status-report

服务状态、网络失败/内部异常计数与 `STATUS_CONTINUOUS_FAILURE / STATUS_INTERNAL_ERROR`；不包含设备密钥和截图。

### 7.4 core.renderer

渲染退出原因、退出码、加载失败和未处理异常；允许错误栈、窗口标题和路径，不允许图像或页面内容。

### 7.5 core.update

关键更新阶段、目标版本与 `UPDATE_CRITICAL_FAILURE`；不包含更新服务 Token。

## 8. 分端责任

- 桌面端：授权 UI、异常触发、中央注册、客户端脱敏、限额/去重/离线队列和能力降级。
- 服务端：从认证推导身份、二次脱敏、未知段保留、聚合/复发/保留清理、本机 CLI。
- Android：维护同一 OpenAPI、信封/功能段/生命周期 DTO、未知段兼容和能力持久化。本轮不得新增授权开关、异常采集、队列或实际上传调用。
