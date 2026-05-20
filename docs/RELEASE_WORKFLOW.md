# Neko Status Desktop 发布工作流

> 适用范围：当前 Electron 桌面端仓库
> 最后更新：2026-05-19

## 1. 目标

这份文档是当前仓库的发布单一事实来源。

- 日常开发通过 `main` 分支和 PR 流转
- 正式发布通过 Git tag 触发 GitHub Actions
- 产物由 `electron-builder` 生成后上传到 GitHub Release；个人 Gitea Release 改为本地脚本上传
- GitHub 和个人仓库使用同一版本、同一 tag、同一份 `release_notes.txt`
- 两个发布目标的资产清单独立配置，允许上传文件数量不同
- 个人仓库写入密钥只保存在本地 `.secrets/gitea-token.txt` 或临时环境变量中，不能写入源码、客户端配置、安装包或 Release 资产
- 更新说明优先读取仓库根目录的 `release_notes.txt`

如果其他历史文档与本文冲突，以本文和仓库中的实际脚本、工作流为准。

## 2. 当前发布入口

当前发布相关命令：

```bash
npm run verify
npm run build
npm run build:zip
npm run release:gitea:dry-run
npm run release:gitea:local
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

## 6. 同步发布步骤

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
7. 在本地下载 GitHub Release 资产并同步到个人 Gitea Release：

```powershell
gh release download v1.2.4 --repo Neko-NF/Neko-Status-Desktop --dir releases/v1.2.4 --clobber
npm run release:gitea:local -- --version 1.2.4 --tag v1.2.4 --files "releases/v1.2.4/NekoStatus-Setup-1.2.4.exe,releases/v1.2.4/NekoStatus-1.2.4-win.zip,releases/v1.2.4/SHA256SUMS.txt"
```

`release.yml` 只创建 GitHub Release，不再读取或同步 `GITEA_TOKEN`。个人仓库同步使用本地 `.secrets/gitea-token.txt`，该目录已被 `.gitignore` 排除。不要把 token 写入 `package.json`、`release_notes.txt`、`neko-config.json`、`.env`、文档示例或任何打包文件。

### Beta 版本

流程相同，只是版本号和 tag 使用 beta 形式，例如：

```bash
git tag v1.3.0-beta.1
git push origin main --tags
```

### Nightly 版本

当前只保留手动触发方式，不作为默认团队流程。

## 7. Release 工作流产物

`release.yml` 默认上传到 GitHub Release 的产物：

- `NekoStatus-Setup-{version}.exe`
- `NekoStatus-{version}-win.zip`
- `SHA256SUMS.txt`

其中：

- `.exe` 适合普通安装
- `.zip` 适合便携或快速验证
- `SHA256SUMS.txt` 用于校验下载一致性

个人 Gitea Release 的默认上传清单与 GitHub 相同，但它是独立配置项。需要减少或增加个人仓库文件时，在本地命令中传入 `--files` 或设置 `GITEA_RELEASE_FILES`，例如：

```text
dist/NekoStatus-Setup-${VERSION}.exe,dist/SHA256SUMS.txt
```

没有配置 `GITEA_RELEASE_FILES` 时，脚本会上传默认三件套；如果 `SHA256SUMS.txt` 不存在，脚本会按上传清单生成。

## 8. 个人仓库发布

个人更新源仓库为：

```text
https://git.koirin.com:39520/NF/Neko
```

这个仓库不是源码主发布链路，只作为客户端个人更新源。发布新版本时必须跟 GitHub Release 同步：同一个 tag、同一个版本、同一份发布说明。它不需要同步完整源码、不需要创建 release 分支，也不需要在该仓库执行构建。

### 默认方式：本地同步 Gitea Release

1. 在源码仓库推送 `v*` tag。
2. GitHub Actions 构建 Windows 产物。
3. 工作流上传 GitHub Release。
4. 本地确认 `.secrets/gitea-token.txt` 存在。
5. 本地用 `gh release download` 下载 GitHub 服务器构建出的同版本资产。
6. 本地运行 `npm run release:gitea:local -- --version <version> --tag v<version> --files "<下载后的资产清单>"` 创建或更新 `https://git.koirin.com:39520/NF/Neko` 的同名 Release。
7. Gitea Release Body 使用同一份 `release_notes.txt`。

个人仓库默认上传：

```text
NekoStatus-Setup-1.2.8.exe
NekoStatus-1.2.8-win.zip
SHA256SUMS.txt
```

其中 `.exe` 是自动更新首选资产，`.zip` 是备用资产，`SHA256SUMS.txt` 用于完整性校验。客户端会通过 Gitea 兼容接口读取 release、更新说明和资产下载地址。

### 本地补发或旧版本测试

如果需要把本地已有旧版本补发到个人仓库，例如 `v1.2.2`，优先使用同一个脚本创建 Gitea Release。默认读取 `.secrets/gitea-token.txt`，也可以用 `--token-file` 指向其他本地 token 文件：

```powershell
npm run release:gitea:local -- --version 1.2.2 --tag v1.2.2 --files "releases/v1.2.2/NekoStatus-Setup-1.2.2.exe,releases/v1.2.2/NekoStatus-1.2.2-win.zip,releases/v1.2.2/SHA256SUMS.txt"
```

正式发布不再推荐把安装包直接提交到个人仓库根目录。根目录模式仅作为 Gitea Release API 不可用时的兜底：

```text
NekoStatus-Setup-1.2.8.exe
NekoStatus-1.2.8-win.zip
SHA256SUMS.txt
release_notes.txt
```

客户端在 release 为空时会读取仓库根目录文件列表，根据文件名中的版本号合成更新结果，并读取 `release_notes.txt` 作为更新说明。文件名必须保留版本号；没有版本号的安装包不会被识别为可更新版本。

然后执行一次“检查更新”。如仓库需要登录访问，必须在个人仓库 token 中填写可读取 release / contents / raw 文件的令牌。

### 本地脚本约定

本地只保留 `scripts/publish-gitea-release.js` 作为个人仓库 Release 上传入口。根目录旧脚本 `publish.ps1`、`publish_node.js`、`create_gitea_release.js` 已废弃并移除，不再作为新版本发布流程依据。

常用命令：

```powershell
npm run release:gitea:dry-run
npm run release:gitea:local
```

## 9. 回滚与撤包

如果发布后发现严重问题，按以下原则处理：

- 普通缺陷：发一个修复版本，不删除历史 tag
- 严重错误产物：删除 GitHub Release，视情况保留 tag
- 必须阻止旧版本继续使用：下一修复版本在 `release_notes.txt` 追加 `<!-- FORCE_UPDATE -->`

推荐命令：

```bash
gh release delete v1.2.4 --yes
```

只有在 tag 本身打错、且必须重用同一个 tag 名称时，才考虑连 tag 一起清理。

个人仓库发布错误时，优先替换 `https://git.koirin.com:39520/NF/Neko` 中对应 release 的资产或根目录文件；如果版本号已经被客户端识别且资产不可用，建议发布更高补丁版本，不要长期复用同一个坏版本号。

## 10. 与仓库现状一致的说明

为避免误解，这里明确当前事实：

- 仓库已经有自动发布工作流，但不是全自动发版
- 发版时机、版本号判断、更新说明仍需要人工负责
- 当前没有 Nightly 定时任务
- 当前发布主链路是 GitHub Actions；GitHub Release 由 workflow 完成，个人 Gitea Release 由本地脚本同步完成
- 个人仓库 `https://git.koirin.com:39520/NF/Neko` 只保存发布资产和更新说明，不作为源码协作入口

## 11. 相关文档

- [release-process.md](/D:/VScode%20project/Neko_Status/docs/release-process.md)
- [testing-guideline.md](/D:/VScode%20project/Neko_Status/docs/testing-guideline.md)
- [CONTRIBUTING.md](/D:/VScode%20project/Neko_Status/CONTRIBUTING.md)
