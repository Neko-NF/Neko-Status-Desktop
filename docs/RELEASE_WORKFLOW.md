# Neko Status — 发版操作手册

> **适用版本**：Neko Status Electron Desktop v1.0.0+  
> **适用平台**：Windows x64  
> **最后更新**：2026-04-05（新增第 13 章：紧急撤包与重发流程）

本文档面向开发人员，一站式涵盖：版本号规范、打包构建、三通道发布、CI/CD 自动化、更新日志规范。

---

## 目录

1. [版本号规范](#1-版本号规范)
2. [三更新通道](#2-三更新通道)
3. [发版触发决策（开发→发布人员交接）](#3-发版触发决策开发发布人员交接)
4. [前置环境准备](#4-前置环境准备)
5. [本地构建](#5-本地构建)
6. [发版流程（一键式）](#6-发版流程一键式)
7. [CI/CD 自动发布](#7-cicd-自动发布)
8. [Release Body 与更新日志规范](#8-release-body-与更新日志规范)
9. [打包产物说明](#9-打包产物说明)
10. [本地归档规范](#10-本地归档规范)
11. [用户视角：自动更新流程](#11-用户视角自动更新流程)
12. [FAQ 故障排查](#12-faq-故障排查)
13. [紧急撤包与重发](#13-紧急撤包与重发)

---

## 1. 版本号规范

遵循 **语义化版本 2.0.0**（[semver.org](https://semver.org/)）：

```
v{MAJOR}.{MINOR}.{PATCH}[-{channel}.{N}]
```

| 段位                | 含义       | 何时递增                            |
| ------------------- | ---------- | ----------------------------------- |
| `MAJOR`             | 破坏性变更 | 架构重构、API 不兼容                |
| `MINOR`             | 新功能     | 新增功能模块，向后兼容              |
| `PATCH`             | Bug 修复   | 修复缺陷、UI 小调整、依赖升级       |
| `-beta.N`           | 公测版     | 功能完整但未经充分测试，N 从 1 递增 |
| `-nightly.YYYYMMDD` | 日构建     | 最新代码快照，仅供测试              |

### 规则

- **禁止跳版**：`v1.0.x → v1.2.0` 不允许，必须先经过 `v1.1.0`
- **Beta 归属**：`v1.1.0-beta.N` 属于 `v1.1.0` 的公测阶段
- **版本排序**：`nightly < beta < 正式版`，即 `v1.1.0-nightly.xxx < v1.1.0-beta.2 < v1.1.0`
- **`package.json` 为准**：`app.getVersion()` 读取的版本号来自 `package.json`

---

## 2. 三更新通道

| 通道    | 配置值    | Tag 格式                  | GitHub Release 类型 | 稳定性 |
| ------- | --------- | ------------------------- | ------------------- | ------ |
| 稳定版  | `stable`  | `v1.0.0`                  | 正式 Release        | ★★★★★  |
| Beta    | `beta`    | `v1.1.0-beta.1`           | Pre-Release         | ★★★☆☆  |
| Nightly | `nightly` | `v1.2.0-nightly.20260310` | Pre-Release         | ★★☆☆☆  |

### 通道继承

- **稳定版**：只接收更高版本的稳定版
- **Beta**：接收稳定版 + Beta 版
- **Nightly**：接收所有版本

---

## 3. 发版决策指南

> 本章节供**负责执行发布操作的开发人员**阅读。  
> 收到代码变更后，按以下规则判断：下一个版本号是什么、Release 类型是什么、是否需要强制更新，然后执行第 6 章的发版流程。

---

### 3.1 根据变更类型判断版本号与 Release 类型

收到变更时，先看变更属于哪种类型，再对应下表：

| 变更类型                                              | 具体示例                                     | 下一版本号                                          | Release 类型                    |
| ----------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- | ------------------------------- |
| **UI / 逻辑 Bug 修复**（不影响核心上报）              | 状态标签显示错误、开关联动失效、界面渲染异常 | 当前在 beta：`beta.N+1`<br>当前在 stable：`PATCH+1` | Pre-Release / 正式 Release      |
| **核心功能 Bug 修复**（影响上报、数据上传、密钥验证） | 上报服务无法启动、数据丢失、截图上传失败     | 当前在 beta：`beta.N+1`<br>当前在 stable：`PATCH+1` | Pre-Release / 正式 Release      |
| **安全漏洞修复**                                      | 密钥泄露风险、IPC 注入防护缺失               | `PATCH+1`（stable）或 `beta.N+1`（beta）            | 正式 Release（优先升为 stable） |
| **新增功能**（向后兼容）                              | 新增状态同步功能、新 UI 模块、新配置项       | `MINOR+1` 开新 beta，如 `1.2.0-beta.1`              | Pre-Release                     |
| **破坏性变更**（API 不兼容、架构重构）                | 更换上报协议、服务端 API 字段不兼容          | `MAJOR+1`，如 `2.0.0-beta.1`                        | Pre-Release                     |
| **Beta 转正式稳定版**                                 | 当前 beta 轮次已充分测试、无遗留问题         | 去掉 `-beta.N`，如 `1.1.0-beta.4 → 1.1.0`           | 正式 Release                    |
| **纯文档 / 注释修改**                                 | README、注释、无任何功能变更                 | **不发版**                                          | —                               |

---

### 3.2 是否需要强制更新

> 强制更新会禁止用户跳过版本，弹窗不可关闭，**谨慎使用**。  
> 启用方式：在 `release_notes.txt` 末尾追加一行 `<!-- FORCE_UPDATE -->`。

| 情况                                    | 强制更新 | 原因                                 |
| --------------------------------------- | :------: | ------------------------------------ |
| UI / 逻辑 Bug 修复（不影响功能）        |    ❌    | 旧版可继续正常使用，无数据风险       |
| 核心上报功能 Bug 修复（有数据丢失风险） |    ✅    | 旧版持续运行会导致数据丢失或上报异常 |
| 安全漏洞修复                            |    ✅    | 旧版存在安全风险，必须强制升级       |
| 服务端 API 字段不兼容变更               |    ✅    | 旧版客户端调用新服务端会返回 400/500 |
| 新增功能（纯增量）                      |    ❌    | 旧版功能不受影响                     |
| Beta 转 Stable                          |    ❌    | 用户自愿升级                         |

---

### 3.3 发布操作清单

确认版本号和是否强制更新后，按以下步骤执行：

```
□ 1. 拉取最新代码
      git pull origin main

□ 2. 修改 package.json 中的 version 字段（按 3.1 规则）

□ 3. 编写 release_notes.txt（格式见第 8 章）
      - 如需强制更新，在文件末尾加一行：<!-- FORCE_UPDATE -->

□ 4. 暂存并提交
      git add package.json release_notes.txt
      git commit -m "release: v{version}"

□ 5. 打 Tag
      git tag v{version}

□ 6. 推送代码 + Tag（触发 CI 自动构建）
      git push origin main --tags

□ 7. 到 GitHub Actions 确认构建成功
      https://github.com/Neko-NF/Neko-Status-Desktop/actions

□ 8. 若此次变更涉及服务端文件，同步部署（见 3.4）
```

---

### 3.4 服务端同步部署说明

客户端发版**不会自动触发**服务端更新，需手动判断是否需要同步部署：

| 情况                                  | 需要服务端同步 | 涉及文件路径（Web 项目 `my-app/` 下） |
| ------------------------------------- | :------------: | ------------------------------------- |
| 新增 / 修改了服务端 API 接口          |       ✅       | `app/api/**`                          |
| 修改了网页前端展示逻辑                |       ✅       | `components/**`、`app/dashboard/**`   |
| 纯客户端 Bug 修复（无服务端代码变更） |       ❌       | —                                     |
| 新增客户端配置项但无对应 API          |       ❌       | —                                     |

> 服务端部署流程见 `服务端部署文档/06_日常运维与更新指南.md`。

---

## 4. 前置环境准备

| 工具        | 版本     | 说明                             |
| ----------- | -------- | -------------------------------- |
| Node.js     | ≥ 22 LTS | 运行 Electron + electron-builder |
| Git         | ≥ 2.40   | Tag 推送触发 CI                  |
| GitHub 账号 | —        | 托管代码与 Releases              |

```powershell
cd "d:\VScode project\Neko_Status"
npm install
```

### 首次使用 CI 前确认

1. 仓库 **Settings → Actions → General → Workflow permissions** → 选择 **Read and write permissions**
2. 确保 `assets/app_icon.ico` 存在

---

## 5. 本地构建

```powershell
cd "d:\VScode project\Neko_Status"

# 一键构建（NSIS 安装包 + ZIP 便携包）
npm run build

# 仅安装包
npm run build:nsis

# 仅 ZIP
npm run build:zip
```

构建产物位于 `dist/` 目录。

### 验证 SHA256

```powershell
(Get-FileHash "dist\NekoStatus-Setup-1.0.0.exe" -Algorithm SHA256).Hash
```

---

## 6. 发版流程（一键式）

> 下面三个场景覆盖日常所有发版需求，跟着做就行。

### 场景 A：发布 Bug 修复（Stable）

```powershell
cd "d:\VScode project\Neko_Status"

# 1. 自动递增 patch 版本号（同时 commit + tag）
npm version patch
# 例：1.0.0 → 1.0.1，自动创建 tag v1.0.1

# 2. 推送代码 + Tag（触发 CI 自动构建发布）
git push origin main --tags
```

### 场景 B：发布 Beta 版

```powershell
cd "d:\VScode project\Neko_Status"

# 1. 手动编辑 package.json 的 version 字段
#    例如改为 "1.1.0-beta.1"

# 2. 提交
git add package.json package-lock.json
git commit -m "release: v1.1.0-beta.1"

# 3. 打 Tag 并推送
git tag v1.1.0-beta.1
git push origin main --tags
```

**后续迭代**：`beta.1 → beta.2 → beta.3 ...` 重复上述步骤，递增 N。

### 场景 C：Beta 转正式版

```powershell
cd "d:\VScode project\Neko_Status"

# 1. 编辑 package.json: "1.1.0-beta.3" → "1.1.0"
# 2. 提交
git add package.json package-lock.json
git commit -m "release: v1.1.0 stable"

# 3. 打 Tag 并推送
git tag v1.1.0
git push origin main --tags
```

### 场景 D：发布 Nightly（可选，通常 CI 自动执行）

```powershell
$date = Get-Date -Format "yyyyMMdd"
git tag "v1.2.0-nightly.$date"
git push origin "v1.2.0-nightly.$date"
```

---

## 7. CI/CD 自动发布

工作流文件：`.github/workflows/release.yml`

### 触发条件

推送匹配以下格式的 Tag 即自动触发：

| Tag 格式                  | Release 类型 |
| ------------------------- | ------------ |
| `v1.0.0`                  | 正式 Release |
| `v1.1.0-beta.1`           | Pre-Release  |
| `v1.2.0-nightly.20260310` | Pre-Release  |

### CI 流程

```
推送 Tag → Checkout 代码 → Node.js 22 → npm ci → npm run build
    → 计算 SHA256 → 判断 pre-release → 创建 Release + 上传产物
```

上传产物包含：`.exe`（安装包）+ `.zip`（便携包）+ `SHA256SUMS.txt`

### 查看构建状态

推送后访问：`https://github.com/Neko-NF/Neko-Status-Desktop/actions`

---

## 8. Release Body 与更新日志规范

### 工作机制

应用的"更新中心 → 更新日志"从 GitHub Releases API 拉取最近 6 个版本，提取 `tag_name`、`published_at`、`body`、`prerelease` 渲染为时间线。

**⚠️ 重要**：Release Body 的内容会直接显示为客户端内的更新日志。**不要**在 Body 中放入安装说明、SHA256 校验命令等非更新内容。

### release_notes.txt 工作流

CI 自动构建时的更新日志来源（按优先级）：

1. **`release_notes.txt`（推荐）**：项目根目录下的文本文件，CI 检测到后直接用作 Release Body
2. **自动生成**：若 `release_notes.txt` 不存在或为空，CI 使用 `generate_release_notes: true` 从 PR / 提交记录自动生成

**发版前必做**：编辑 `release_notes.txt`，写入本次发版的实际更新内容：

```markdown
## 新功能

- 功能描述 A
- 功能描述 B

## 修复

- 修复了某问题

## 改进

- 性能优化项目
```

**发版后可选**：清空或更新 `release_notes.txt` 为下一版本做准备。

### 格式规则

- 使用 `## 标题` 分节，客户端原样展示
- 每个功能/修复一行，以 `- ` 开头
- 避免嵌套列表或大段代码块
- 留空时客户端显示"暂无更新说明"
- **禁止**在更新日志中写安装说明或 SHA256 校验信息（安装说明由 CI 折叠到 `<details>` 中或省略）

### 强制更新标记

当某个版本必须强制用户更新时（例如安全漏洞修复、不兼容的 API 变更），在 Release Body 末尾添加以下 HTML 注释标记：

```markdown
## 修复

- 修复了关键安全漏洞

<!-- FORCE_UPDATE -->
```

客户端检测到此标记后的行为：

| 场景     | 行为                                         |
| -------- | -------------------------------------------- |
| 普通更新 | 弹窗显示「立即更新」和「跳过此版本」两个按钮 |
| 强制更新 | 弹窗仅显示「立即更新」，不可关闭、不可跳过   |

> ⚠️ **注意**：强制更新应谨慎使用，仅在安全更新或严重兼容性问题时启用。

### Release 标题格式（CI 自动生成）

```
Neko Status v1.0.1          # 稳定版
Neko Status v1.1.0-beta.1   # Beta
```

### 本地缓存

- 成功拉取后缓存到 `neko-config.json → changelogCache`（固定 6 条）
- 网络失败时自动回退本地缓存，离线可用

---

## 9. 打包产物说明

| 文件                             | 说明                              | 推荐场景              |
| -------------------------------- | --------------------------------- | --------------------- |
| `NekoStatus-Setup-{version}.exe` | NSIS 安装包（含注册表、快捷方式） | 首次安装 / 大版本升级 |
| `NekoStatus-{version}-win.zip`   | ZIP 便携包，解压即用              | 覆盖更新 / 绿色便携   |
| `SHA256SUMS.txt`                 | 文件哈希校验表                    | 安全校验              |

---

## 10. 本地归档规范

每次发版构建完成后，将产物归档到本地 `releases/` 目录，便于回溯和离线分发。

### 目录结构

```
releases/
├── v1.0.0-beta.1/
│   ├── NekoStatus-Setup-1.0.0-beta.1.exe
│   ├── NekoStatus-1.0.0-beta.1-win.zip
│   └── SHA256SUMS.txt
├── v1.0.0-beta.2/
│   ├── NekoStatus-Setup-1.0.0-beta.2.exe
│   ├── NekoStatus-1.0.0-beta.2-win.zip
│   └── SHA256SUMS.txt
└── v1.1.0/
    └── ...
```

### 归档命令

每次 `npm run build` 完成后执行：

```powershell
$version = (Get-Content package.json | ConvertFrom-Json).version
$dir = "releases\v$version"
New-Item -ItemType Directory -Path $dir -Force | Out-Null

# 复制产物
Copy-Item "dist\NekoStatus-Setup-$version.exe" $dir
Copy-Item "dist\NekoStatus-$version-win.zip" $dir

# 生成 SHA256
$files = @("NekoStatus-Setup-$version.exe", "NekoStatus-$version-win.zip")
$lines = foreach ($f in $files) {
    $h = (Get-FileHash "$dir\$f" -Algorithm SHA256).Hash
    "$h  $f"
}
$lines | Out-File -FilePath "$dir\SHA256SUMS.txt" -Encoding ascii

Write-Host "已归档到 $dir"
```

### 注意事项

- `releases/` 已加入 `.gitignore`，**不会被推送到 GitHub**
- 每个版本独立子目录，目录名与 Tag 一致（`v{version}`）
- 归档仅用于本地备份；GitHub Release 上的产物由 CI 自动上传
- 旧版本按需保留或清理，建议至少保留最近 3 个版本

---

## 11. 用户视角：自动更新流程

### 设置页配置项

| 配置项       | 说明                    | 公开仓库              | 私有仓库              |
| ------------ | ----------------------- | --------------------- | --------------------- |
| GitHub Owner | 仓库所有者              | `Neko-NF`             | `Neko-NF`             |
| GitHub Repo  | 仓库名称                | `Neko-Status-Desktop` | `Neko-Status-Desktop` |
| GitHub Token | 访问令牌                | **留空即可**          | 必须填写 PAT          |
| 更新通道     | stable / beta / nightly | 按需选择              | 按需选择              |

### 更新流程

```
检查更新 → GitHub Releases API → 发现新版本 → 检查跳过版本/强制更新
    → 弹出更新弹窗（显示版本号、更新内容、文件大小、发布日期）
    → 用户操作：
       • 普通更新：「立即更新」或「跳过此版本」
       • 强制更新：仅「立即更新」（不可关闭弹窗）
    → 点击「立即更新」 → 流式下载 .exe → SHA256 校验
    → 启动安装程序 → NSIS 覆盖安装 → 重启
```

### 跳过版本逻辑

- 用户点击「跳过此版本」后，版本号存入 `skippedVersion` 配置
- 后续更新检查中，若最新版本与 `skippedVersion` 匹配且非强制更新，则不显示弹窗
- 当更高版本发布后，`skippedVersion` 自动失效（因为版本号不再匹配）

---

## 12. FAQ 故障排查

### Q: `npm run build` 报错 "Cannot find icon"

```powershell
Test-Path "assets\app_icon.ico"   # 应返回 True
```

### Q: GitHub Actions 构建失败 "permission denied"

Settings → Actions → General → Workflow permissions → 改为 **Read and write permissions**

### Q: 安装包提示 SmartScreen 拦截

未签名的安装包会触发。临时解决：点击「更多信息」→「仍要运行」。

### Q: SHA256 校验失败

重新下载。可能是下载中断导致文件损坏。

### Q: electron-builder 安装缓慢

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install
```

### Q: CI 构建报错 `EJSONPARSE` / `Bad control character in string literal`

**根因**：用 PowerShell 修改 `package.json` 时，`Set-Content -Encoding UTF8` 会在文件头部写入 **UTF-8 BOM**（`EF BB BF`），JSON 解析器不识别 BOM，导致 `npm run build` / `npm ci` 崩溃。

**正确的修改方式**：使用 .NET API 写入无 BOM 的 UTF-8 文件：

```powershell
# ✅ 正确：无 BOM 写入
$content = Get-Content package.json -Raw
$content = $content -replace '"version": "旧版本号"', '"version": "新版本号"'
[System.IO.File]::WriteAllText(
    (Resolve-Path "package.json").Path,
    $content,
    (New-Object System.Text.UTF8Encoding $false)   # $false = 不含 BOM
)
```

**禁止用法**：
```powershell
# ❌ 错误：Out-File / Set-Content 默认写 BOM，会破坏 JSON
$content | Set-Content package.json -Encoding UTF8
$content | Out-File package.json -Encoding utf8
```

**验证是否含 BOM**：
```powershell
$bytes = [System.IO.File]::ReadAllBytes("package.json")
"First byte: $($bytes[0])"   # 应为 123（ASCII '{'），若为 239 则含 BOM
```

**已含 BOM 的快速修复**：
```powershell
# 从 git 恢复原文件后用正确方式重写版本号
$content = git show HEAD:package.json | Out-String
$content = $content -replace '"version": "旧版本号"', '"version": "新版本号"'
[System.IO.File]::WriteAllText(
    (Resolve-Path "package.json").Path,
    $content.TrimStart([char]0xFEFF),   # 额外剥离 BOM 字符
    (New-Object System.Text.UTF8Encoding $false)
)
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('JSON valid')"
```

---

## 13. 紧急撤包与重发

> 已发布的版本发现严重 Bug 或发布了错误产物，需要立即撤回并重新发布时，按本章操作。

### 13.1 触发撤包的条件

| 情况                                                 |          是否撤包          |
| ---------------------------------------------------- | :------------------------: |
| 发现严重 Bug，旧版持续运行会造成数据丢失或上报异常   |             ✅             |
| 发现安全漏洞，旧版存在密钥泄露或注入风险             |             ✅             |
| 打包了错误的产物（如带有未完成功能的代码、debug 包） |             ✅             |
| UI 显示问题、轻微逻辑错误，旧版可继续使用            | ❌（发新版即可，旧版保留） |

---

### 13.2 撤包操作步骤

```
□ 1. 删除 GitHub Release（移除可下载产物）
      gh release delete v{问题版本} --yes
      # --yes 跳过确认交互
      # 此操作仅删除 Release 页面和产物，git tag 仍保留

□ 2. 确认 Release 已被删除
      gh release list
      # 确认问题版本不再出现

□ 3. 修复代码（在本地完成 Bug 修复）

□ 4. 按正常发版流程发布新的修复版本（见第 3 章）
      # Beta 阶段：版本号 → beta.N+1
      # Stable 阶段：版本号 → PATCH+1

□ 5. 若问题版本已被部分用户下载，评估是否需强制更新
      # 若旧版持续运行有风险 → release_notes.txt 末尾加 <!-- FORCE_UPDATE -->
      # 仅影响展示/体验 → 不强制
```

> **关于 git tag**：`gh release delete` 只删除 Release，不删除 git tag。这是有意设计——保留 tag 可追溯历史版本对应的代码快照。如确实需要同时删除 tag，追加 `--cleanup-tag` 参数，但通常不建议这样做。

---

### 13.3 是否需要删除 git tag

| 情况                                               |    是否删除 git tag    | 操作                                            |
| -------------------------------------------------- | :--------------------: | ----------------------------------------------- |
| 仅撤回产物，保留代码历史                           |       ❌（推荐）       | 只执行 `gh release delete`                      |
| tag 打错了版本号（如打成 v1.2.0 实为 v1.1.0 内容） |           ✅           | `gh release delete v{版本} --cleanup-tag --yes` |
| 需要在同一 tag 名重新打包发布                      | ✅（必须删除才能重用） | 同上，然后重新打 tag                            |

---

### 13.4 注意事项

- GitHub Release 一旦删除，**所有已上传的产物（.exe / .zip / SHA256SUMS.txt）均被移除**，已下载的用户不受影响
- 已分发给用户的安装包**无法召回**，只能通过强制更新引导用户升级
- 如果使用 `--cleanup-tag` 删除了 tag，且该 tag 已被其他人 clone，对方本地仍会保留该 tag，需提醒相关人员执行 `git fetch --prune --tags`
- 撤包后务必在新版本 `release_notes.txt` 中说明撤包原因，如：`- 因 vX.X.X 存在 [问题描述]，该版本已下架，本版本为修复版本`

---

## 附录：快速参考

```
═══════════════════════════════════════════════════════
  发版速查 — 收到变更后按类型执行对应命令
═══════════════════════════════════════════════════════

【Beta 阶段 Bug 修复（不强制更新）】
  1. package.json version → "x.x.0-beta.N+1"
  2. 编写 release_notes.txt（不加 FORCE_UPDATE）
  3. git add package.json release_notes.txt
  4. git commit -m "release: vx.x.0-beta.N+1"
  5. git tag vx.x.0-beta.N+1
  6. git push origin main --tags

【Beta 阶段 Bug 修复（需要强制更新）】
  同上，但 release_notes.txt 末尾加一行：
  <!-- FORCE_UPDATE -->

【Stable 阶段 Bug 修复】
  1. package.json version → "x.x.PATCH+1"
  2. 编写 release_notes.txt
  3. git add package.json release_notes.txt
  4. git commit -m "release: vx.x.PATCH+1"
  5. git tag vx.x.PATCH+1
  6. git push origin main --tags

【新功能 → 新 Beta 序列】
  1. package.json version → "x.MINOR+1.0-beta.1"
  2. 编写 release_notes.txt
  3. git add package.json release_notes.txt
  4. git commit -m "release: vx.MINOR+1.0-beta.1"
  5. git tag vx.MINOR+1.0-beta.1
  6. git push origin main --tags

【Beta → 正式稳定版】
  1. package.json version → "x.x.0"（去掉 -beta.N）
  2. 编写 release_notes.txt
  3. git add package.json release_notes.txt
  4. git commit -m "release: vx.x.0 stable"
  5. git tag vx.x.0
  6. git push origin main --tags

【查看 CI 构建状态】
  https://github.com/Neko-NF/Neko-Status-Desktop/actions

【紧急撤包（删除 Release，保留 git tag）】
  gh release delete v{问题版本} --yes
  # 然后修复代码，正常流程发布新版本

【紧急撤包（同时删除 git tag，用于重打同名 tag）】
  gh release delete v{问题版本} --cleanup-tag --yes
  # 警告：会破坏已 clone 该 tag 的其他环境
═══════════════════════════════════════════════════════
```
