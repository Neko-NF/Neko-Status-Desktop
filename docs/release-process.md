# 发布流程

本文定义 Neko Status Desktop 的 PR 质量门禁、版本发布和回滚规则。完整排障细节可参考 `docs/RELEASE_WORKFLOW.md`，本文件作为团队日常发布入口。

## 分支与 PR

建议分支命名：

```text
feature/<short-name>
fix/<short-name>
refactor/<short-name>
docs/<short-name>
release/<version>
```

PR 必须填写：

- 改动摘要。
- 影响范围。
- 测试结果。
- 是否改动 IPC、配置、发布流程。
- UI 改动截图或说明。
- 风险和回滚方式。

## PR 质量门禁

PR 阶段由 GitHub Actions 执行：

```text
.github/workflows/ci.yml
.github/workflows/build-check.yml
```

本地提交前建议执行：

```bash
npm run verify
npm run test:smoke
```

涉及打包、更新、安装器、release workflow 时，还需要：

```bash
npm run build:zip
```

## 版本号

版本号以 `package.json` 的 `version` 为准。Tag 必须与版本一致：

```text
v1.2.7
v1.3.0-beta.1
v1.3.0-nightly.20260519
```

通道含义：

- `stable`：正式版本。
- `beta`：预发布版本。
- `nightly`：保留通道，当前不做定时自动发布。

## 发布前检查

发布前必须确认：

```bash
npm run verify
npm run test:smoke
npm run build:zip
```

检查项：

- `package.json` version 正确。
- 更新说明已准备。
- ZIP 可生成。
- release workflow 未被破坏。
- `CHANGELOG.md` 或 release notes 已同步。
- 没有临时日志、heap dump、构建缓存进入提交。

## 正式发布流程

1. 从主分支创建 release 分支。
2. 更新 `package.json` version。
3. 更新 release notes / changelog。
4. 运行发布前检查。
5. 合并 release PR。
6. 创建并推送 `v*` tag。
7. GitHub Actions 执行 `.github/workflows/release.yml`。
8. 检查产物、SHA256、Release notes。

## 产物要求

Release 产物应包含：

- Windows 安装包或 ZIP。
- `SHA256SUMS.txt`。
- 清晰的 release notes。

构建输出目录：

```text
dist/
  win-unpacked/
  NekoStatus-<version>-win.zip
```

`dist` 不进入源码提交。

## 回滚

需要回滚时：

1. 判断是应用代码、更新配置还是发布产物问题。
2. 若是代码问题，提交修复版本并发布新 tag。
3. 若是 release notes 或产物标记问题，优先修正 GitHub Release。
4. 若更新包不可用，暂停自动更新通道或跳过对应版本。
5. 在 PR / Release 中说明影响范围和用户动作。

## 发布风险点

- tag version 与 `package.json` 不一致。
- release workflow 只在 `v*` tag 触发。
- Windows 签名信息为空时会跳过签名，这是当前可接受状态，但 release notes 应说明。
- 开发态 Electron GPU 问题不等同于打包产物不可用，需用 `build:zip` 或正式 exe 对照。
- IPC 或配置变更必须保持向后兼容，否则旧版本升级可能失败。
