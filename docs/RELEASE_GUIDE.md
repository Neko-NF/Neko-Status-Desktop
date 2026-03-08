# Neko Status — 打包、发布与 GitHub 上传完整操作手册

> **适用版本**：Neko Status Electron Desktop v1.0.0+  
> **适用平台**：Windows x64  
> **最后更新**：2026-03-09

---

## 目录

1. [前置环境准备](#1-前置环境准备)
2. [首次创建 GitHub 仓库并推送代码](#2-首次创建-github-仓库并推送代码)
3. [本地手动打包](#3-本地手动打包)
4. [打包产物说明](#4-打包产物说明)
5. [发布新版本（手动流程）](#5-发布新版本手动流程)
6. [自动发布 CI/CD（GitHub Actions）](#6-自动发布-cicd-github-actions)
7. [三通道发布流程](#7-三通道发布流程)
8. [用户更新流程（客户端视角）](#8-用户更新流程客户端视角)
9. [FAQ 故障排查](#9-faq-故障排查)

---

## 1. 前置环境准备

### 所需工具

| 工具                      | 版本      | 说明                                  |
| ------------------------- | --------- | ------------------------------------- |
| Node.js                   | ≥ 22 LTS  | 运行 Electron + electron-builder      |
| Git                       | ≥ 2.40    | 版本管理与 Tag 推送                   |
| GitHub 账号               | —         | 托管代码与 Releases                   |
| Visual Studio Build Tools | 2019/2022 | electron-builder 编译原生模块（可选） |

### 安装依赖

```powershell
# 在项目根目录执行
cd "d:\VScode project\Neko_Status"
npm install
```

> `electron-builder` 已配置在 `devDependencies` 中，`npm install` 后即可用。

---

## 2. 首次创建 GitHub 仓库并推送代码

### Step 1：在 GitHub 创建仓库

1. 登录 GitHub → New repository
2. Repository name：`neko-status-desktop`（或其他你喜欢的名称）
3. Visibility：**Private**（推荐，防止代码泄露）
4. **不勾选** Add README / .gitignore（本地已有）
5. 点击 Create repository

### Step 2：配置 .gitignore

确认项目根目录有 `.gitignore`，至少包含：

```gitignore
node_modules/
dist/
.env
*.local
```

如果没有，执行：

```powershell
@"
node_modules/
dist/
.env
*.local
"@ | Out-File -FilePath .gitignore -Encoding utf8
```

### Step 3：初始化 Git 并关联仓库

```powershell
cd "d:\VScode project\Neko_Status"

# 初始化（如果还没有.git目录）
git init
git branch -M main

# 关联远程仓库（替换为你的仓库地址）
git remote add origin https://github.com/YOUR_USERNAME/neko-status-desktop.git

# 首次提交并推送
git add .
git commit -m "feat: initial commit - Neko Status v1.0.0"
git push -u origin main
```

### Step 4：在 GitHub Actions 设置 Token 权限

GitHub Actions 默认 `GITHUB_TOKEN` 有创建 Release 的权限（`contents: write` 已在 workflow 中声明），无需额外配置。

若仓库为 **私有仓库** 且需要客户端访问 Releases，需要创建 Personal Access Token（PAT）：

1. GitHub → Settings → Developer settings → Tokens (classic) → Generate new token
2. Scopes：勾选 `repo`（包含 `read:packages`）
3. 将 token 保存到用户设置中，供客户端 `githubToken` 字段使用

---

## 3. 本地手动打包

### 一键构建（NSIS 安装包 + ZIP 便携包）

```powershell
cd "d:\VScode project\Neko_Status"
npm run build
```

执行后，在 `dist/` 目录会生成：

```
dist/
├── NekoStatus-Setup-1.0.0.exe   ← NSIS 安装包
├── NekoStatus-1.0.0-win.zip     ← ZIP 便携包
└── builder-effective-config.yaml
```

### 仅构建安装包

```powershell
npm run build:nsis
```

### 仅构建 ZIP

```powershell
npm run build:zip
```

### 本地测试打包结果

```powershell
# 直接运行安装包
.\dist\NekoStatus-Setup-1.0.0.exe
```

---

## 4. 打包产物说明

| 文件                             | 说明                                              | 推荐场景              |
| -------------------------------- | ------------------------------------------------- | --------------------- |
| `NekoStatus-Setup-{version}.exe` | NSIS 安装包，含注册表写入、开始菜单、桌面快捷方式 | 首次安装 / 大版本升级 |
| `NekoStatus-{version}-win.zip`   | ZIP 便携包，直接解压即用                          | 覆盖更新 / 绿色便携   |
| `SHA256SUMS.txt`                 | 文件哈希校验表，防篡改验证                        | Release 安全校验      |

### 验证 SHA256

```powershell
# 计算实际哈希
(Get-FileHash "dist\NekoStatus-Setup-1.0.0.exe" -Algorithm SHA256).Hash

# 与 SHA256SUMS.txt 中的值对比
Get-Content "dist\SHA256SUMS.txt"
```

---

## 5. 发布新版本（手动流程）

### Step 1：更新版本号

```powershell
# Bug 修复版本: 1.0.0 → 1.0.1
npm version patch

# 新功能版本: 1.0.0 → 1.1.0
npm version minor

# Beta 版本（手动编辑 package.json）
# 将 version 改为 "1.1.0-beta.1"
```

> `npm version` 会自动修改 `package.json`、`package-lock.json`，并创建一个本地 Git commit + Tag。

### Step 2：本地构建验证

```powershell
npm run build
# 确认 dist/ 中的安装包版本号正确
```

### Step 3：推送代码和 Tag

```powershell
# 推送代码
git push origin main

# 推送 Tag（触发 CI/CD 自动构建发布）
git push origin v1.0.1
```

### Step 4：查看 GitHub Actions

访问 `https://github.com/YOUR_USERNAME/neko-status-desktop/actions` 确认工作流运行成功。

构建完成后，在 `Releases` 页面可看到新版本已发布。

---

## 6. 自动发布 CI/CD（GitHub Actions）

工作流文件位置：`.github/workflows/release.yml`

### 触发条件

| Tag 格式                  | 触发类型 | Release 类型                   |
| ------------------------- | -------- | ------------------------------ |
| `v1.0.0`                  | 推送 Tag | 正式 Release（非 pre-release） |
| `v1.1.0-beta.1`           | 推送 Tag | Pre-Release                    |
| `v1.2.0-nightly.20260310` | 推送 Tag | Pre-Release                    |

### 工作流步骤

```
推送 Tag
    ↓
Checkout 代码（Windows Runner）
    ↓
安装 Node.js 22
    ↓
npm ci（安装依赖）
    ↓
npm run build（electron-builder）
    ↓
计算 SHA256（生成 SHA256SUMS.txt）
    ↓
判断是否 pre-release
    ↓
创建 GitHub Release + 上传产物（.exe + .zip + SHA256SUMS.txt）
```

### 首次使用前确认

1. 仓库 Settings → Actions → General → Workflow permissions → 选择 **Read and write permissions**
2. 确保 `assets/app_icon.ico` 存在（打包图标）

---

## 7. 三通道发布流程

### 稳定版（Stable） - 绿色标签 ●

适合：所有用户；经过完整测试。

```powershell
# 确保在 main 分支，所有测试通过
git checkout main
git pull

npm version minor   # 或 patch
git push origin main
git push origin v1.1.0   # 触发 stable release
```

### Beta 版 - 橙色标签 ●

适合：愿意尝鲜的用户；功能完整但可能有小问题。

```powershell
# 在 develop 或 main 分支
# 手动编辑 package.json: version → "1.1.0-beta.1"
git add package.json
git commit -m "chore: bump version to 1.1.0-beta.1"
git tag v1.1.0-beta.1
git push origin HEAD --tags   # 触发 beta pre-release
```

### Nightly 版 - 紫色标签 ●

适合：开发者/测试人员；最新构建，仅供测试。

```powershell
# 手动触发（通常由 CI 自动每日执行）
$date = Get-Date -Format "yyyyMMdd"
$tag = "v1.2.0-nightly.$date"
git tag $tag
git push origin $tag   # 触发 nightly pre-release
```

### Beta 升为正式版

```powershell
# 测试通过后，从 1.1.0-beta.X 升为 1.1.0
# 手动编辑 package.json: version → "1.1.0"
git add package.json
git commit -m "chore: release v1.1.0 stable"
git tag v1.1.0
git push origin main v1.1.0
```

---

## 8. 用户更新流程（客户端视角）

### 自动检查

1. 用户在「更新中心」选择更新通道（稳定版 / Beta / Nightly）
2. 点击「检查更新」→ 客户端调用 GitHub Releases API
3. 检测到新版本 → 显示更新日志 + 下载按钮

### 下载与安装

```
点击"立即更新"
    ↓
流式下载 .exe 安装包（显示进度条）
    ↓
SHA256 校验（与 SHA256SUMS.txt 对比）
    ↓
校验通过 → shell.openPath(安装包)
    ↓
NSIS 安装程序接管（UAC 提权 → 覆盖安装）
    ↓
安装完成 → 自动重启新版本
```

### 用户配置要求（设置页面）

| 配置项       | 说明                    | 示例                          |
| ------------ | ----------------------- | ----------------------------- |
| GitHub Owner | 仓库所有者用户名        | `your-github-username`        |
| GitHub Repo  | 仓库名称                | `neko-status-desktop`         |
| GitHub Token | 私有仓库访问令牌（PAT） | `ghp_xxxxx`（公开仓库可留空） |
| 更新通道     | stable / beta / nightly | `stable`（推荐）              |

---

## 9. FAQ 故障排查

### Q: `npm run build` 报错 "Cannot find icon"

检查 `assets/app_icon.ico` 是否存在。electron-builder 需要图标文件。

```powershell
Test-Path "assets\app_icon.ico"   # 应返回 True
```

如没有图标，可临时使用任意 `.ico` 文件，或修改 `package.json` 中 `win.icon` 为有效路径。

### Q: GitHub Actions 构建失败 "permission denied"

检查：Settings → Actions → General → Workflow permissions，确保为 **Read and write permissions**。

### Q: 私有仓库用户收不到更新

用户需要在设置页面填写 **GitHub Personal Access Token**（PAT），Scope 需包含 `repo`。

### Q: 安装包运行后提示 SmartScreen 拦截

原因：安装包未经过代码签名（EV 证书）。  
临时解决：点击「更多信息」→「仍要运行」。  
长期解决：购买 Windows 代码签名证书并在 electron-builder 配置中启用签名。

### Q: SHA256 校验失败

原因可能为：

1. 下载中断导致文件损坏 → 重新下载
2. CDN 缓存了旧文件 → 清理浏览器缓存

### Q: `electron-builder` 安装缓慢

可使用国内镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install
```
