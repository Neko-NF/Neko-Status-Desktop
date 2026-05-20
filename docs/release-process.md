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
8. 工作流创建 GitHub Release。
9. 本地用 `gh release download` 下载 GitHub 服务器构建出的同版本资产，再运行 `npm run release:gitea:local -- --version <version> --tag v<version> --files "<资产清单>"` 创建或更新个人 Gitea Release。
10. 检查两个仓库的产物、SHA256、Release notes。

## 个人仓库发布流程

个人更新源仓库固定使用：

```text
https://git.koirin.com:39520/NF/Neko
```

这个仓库只承担分发职责。发布新版本时必须与 GitHub Release 同步，同一个 tag、同一个版本、同一份发布说明。它不需要同步源码、不需要 release 分支、不需要在个人仓库重新构建。个人仓库写入密钥只保存在本地 `.secrets/gitea-token.txt` 或临时环境变量中，不能跟随版本产物一起发布，不能进入源码、客户端配置、安装包或 Release 资产。

默认由本地脚本同步创建 Gitea Release：

1. 本地准备 `.secrets/gitea-token.txt`，该目录已被 `.gitignore` 排除。
2. 可选设置环境变量：`GITEA_BASE_URL`、`GITEA_OWNER`、`GITEA_REPO`、`GITEA_RELEASE_FILES`。
3. 推送 `v*` tag 后，工作流先发布 GitHub Release。
4. 本地调用 `gh release download v<version> --repo Neko-NF/Neko-Status-Desktop --dir releases/v<version> --clobber` 下载 GitHub Release 资产。
5. 本地调用 `npm run release:gitea:local -- --version <version> --tag v<version> --files "<下载后的资产清单>"` 发布个人仓库。
6. 客户端选择个人仓库更新源后执行一次“检查更新”验证。

默认上传清单：

```text
NekoStatus-Setup-1.2.8.exe
NekoStatus-1.2.8-win.zip
SHA256SUMS.txt
```

如果个人仓库和 GitHub 需要不同文件数量，只修改本地 `GITEA_RELEASE_FILES` 或命令中的 `--files`。GitHub Release 的文件清单仍由 `.github/workflows/release.yml` 中的 `files` 控制。

本地补发旧版本测试：

```powershell
npm run release:gitea:local -- --version 1.2.2 --tag v1.2.2 --files "releases/v1.2.2/NekoStatus-Setup-1.2.2.exe,releases/v1.2.2/NekoStatus-1.2.2-win.zip,releases/v1.2.2/SHA256SUMS.txt"
```

如果 Gitea Release API 不可用，也可以临时将以下文件直接放在仓库根目录：

```text
NekoStatus-Setup-1.2.8.exe
NekoStatus-1.2.8-win.zip
SHA256SUMS.txt
release_notes.txt
```

根目录模式下，安装包文件名必须包含版本号，客户端会读取 `release_notes.txt` 作为更新说明。

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
