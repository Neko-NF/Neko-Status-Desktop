# Neko Status Desktop 发布工作流

> 适用范围：当前 Electron 桌面端仓库
> 最后更新：2026-05-17

## 1. 目标

这份文档是当前仓库的发布单一事实来源。

- 日常开发通过 `main` 分支和 PR 流转
- 正式发布通过 Git tag 触发 GitHub Actions
- 产物由 `electron-builder` 生成并上传到 GitHub Release
- 更新说明优先读取仓库根目录的 `release_notes.txt`

如果其他历史文档与本文冲突，以本文和仓库中的实际脚本、工作流为准。

## 2. 当前发布入口

当前发布相关命令：

```bash
npm run verify
npm run build
npm run build:zip
```

当前 GitHub Actions：

- `.github/workflows/ci.yml`
- `.github/workflows/build-check.yml`
- `.github/workflows/release.yml`

触发规则：

- `ci.yml`：`pull_request`、`push main`
- `build-check.yml`：`pull_request`
- `release.yml`：推送 `v*` tag

## 3. 版本与渠道

当前项目仍使用三种发布渠道：

- `stable`：稳定版，tag 形如 `v1.2.3`
- `beta`：预发布版，tag 形如 `v1.3.0-beta.1`
- `nightly`：夜间版，tag 形如 `v1.3.0-nightly.20260517`

约定：

- `package.json` 的 `version` 必须与准备发布的版本一致
- `stable` 只用于可以直接推送给普通用户的版本
- `beta` 用于功能验证和灰度
- `nightly` 保留命名规则，但当前仓库没有启用定时自动构建

## 4. 发布前检查

发布前至少完成以下检查：

1. 工作区确认没有误提交的临时文件。
2. `npm run verify` 通过。
3. `npm run build` 或 `npm run build:zip` 在本地通过。
4. 与本次修改相关的手工 smoke test 已完成。
5. `release_notes.txt` 已按本次版本更新。

推荐手工 smoke test：

- 应用能正常启动
- 主窗口、托盘、设置页可打开
- 关键 IPC 功能未出现明显报错
- 如涉及更新逻辑，至少验证更新页可正常展示当前版本信息

## 5. 更新说明规则

`release_notes.txt` 是当前发布说明首选来源。

建议格式：

```md
## 新增

- 新功能 A

## 修复

- 修复问题 B

## 工程化

- 调整 CI 或测试流程
```

规则：

- 每个变更点一行
- 不写安装教程
- 不写 SHA256 校验命令
- 不写和用户无关的内部噪音

### 强制更新标记

如果某个版本必须强制用户升级，在 `release_notes.txt` 末尾追加：

```html
<!-- FORCE_UPDATE -->
```

当前 Electron 客户端会基于该标记决定是否显示强制更新行为。

## 6. 正式发布步骤

### Stable 版本

1. 确认 `package.json` 中版本号为目标版本，例如 `1.2.4`
2. 更新 `release_notes.txt`
3. 运行：

```bash
npm run verify
npm run build
```

4. 提交发布变更：

```bash
git add package.json package-lock.json release_notes.txt
git commit -m "release: v1.2.4"
```

5. 打 tag 并推送：

```bash
git tag v1.2.4
git push origin main --tags
```

6. 到 GitHub Actions 检查 `Release` 工作流是否成功。

### Beta 版本

流程相同，只是版本号和 tag 使用 beta 形式，例如：

```bash
git tag v1.3.0-beta.1
git push origin main --tags
```

### Nightly 版本

当前只保留手动触发方式，不作为默认团队流程。

## 7. Release 工作流产物

`release.yml` 生成并上传以下产物：

- `NekoStatus-Setup-{version}.exe`
- `NekoStatus-{version}-win.zip`
- `SHA256SUMS.txt`

其中：

- `.exe` 适合普通安装
- `.zip` 适合便携或快速验证
- `SHA256SUMS.txt` 用于校验下载一致性

## 8. 回滚与撤包

如果发布后发现严重问题，按以下原则处理：

- 普通缺陷：发一个修复版本，不删除历史 tag
- 严重错误产物：删除 GitHub Release，视情况保留 tag
- 必须阻止旧版本继续使用：下一修复版本在 `release_notes.txt` 追加 `<!-- FORCE_UPDATE -->`

推荐命令：

```bash
gh release delete v1.2.4 --yes
```

只有在 tag 本身打错、且必须重用同一个 tag 名称时，才考虑连 tag 一起清理。

## 9. 与仓库现状一致的说明

为避免误解，这里明确当前事实：

- 仓库已经有自动发布工作流，但不是全自动发版
- 发版时机、版本号判断、更新说明仍需要人工负责
- 当前没有 Nightly 定时任务
- 当前发布主链路是 GitHub Actions，不再推荐维护单独的手工上传主流程

## 10. 相关文档

- [release-process.md](/D:/VScode%20project/Neko_Status/docs/release-process.md)
- [testing-guideline.md](/D:/VScode%20project/Neko_Status/docs/testing-guideline.md)
- [CONTRIBUTING.md](/D:/VScode%20project/Neko_Status/CONTRIBUTING.md)
