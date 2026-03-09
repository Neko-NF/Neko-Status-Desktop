# Neko Status Desktop — 构建打包上传实战指南（踩坑记录）

> **文档性质**：实战操作记录 + 踩坑避坑指南  
> **首次编写**：2026-03-09（基于 v1.0.0-beta.1 首次构建全流程）  
> **配套文档**：[RELEASE_GUIDE.md](RELEASE_GUIDE.md)（标准流程）、[VERSION_CONVENTION.md](VERSION_CONVENTION.md)（版本号规范）

---

## 一、环境要求（实测版本）

| 工具             | 实测版本     | 注意事项                                                                          |
| ---------------- | ------------ | --------------------------------------------------------------------------------- |
| Node.js          | 22 LTS       | 必须 ≥ 18，低版本 electron-builder 报错                                           |
| npm              | 10+          | `npm ci` 比 `npm install` 更可靠                                                  |
| electron         | 40.8.0       | 首次构建会下载 ~138MB electron zip                                                |
| electron-builder | 25.1.8+      | `devDependencies` 中已声明                                                        |
| Python + Pillow  | 3.11+        | **仅生成图标时需要**，非必须                                                      |
| curl.exe         | Windows 自带 | 上传大文件到 GitHub 必须用 curl，PowerShell 的 `Invoke-RestMethod` 对大文件有 bug |
| Git              | 2.40+        | 推送 workflow 文件需要 PAT 有 `workflow` scope                                    |

---

## 二、构建前必须检查的事项

### 2.1 图标文件（最常见的构建失败原因）

electron-builder 要求 `assets/app_icon.ico` **必须包含 256×256** 尺寸的帧，否则报错：

```
⨯ image D:\...\assets\app_icon.ico must be at least 256x256
```

**检查方法**（需要 Python + Pillow）：

```powershell
python -c "from PIL import Image; img = Image.open('assets/app_icon.ico'); print('sizes:', img.info.get('sizes'))"
```

正确输出应包含 `(256, 256)`：

```
sizes: {(16, 16), (32, 32), (64, 64), (128, 128), (48, 48), (256, 256)}
```

**如果图标不够大，用以下脚本从任意 PNG 生成合规 ICO**：

```python
# generate_ico.py — 从源 PNG 生成多尺寸 ICO
from PIL import Image
import struct, io

src = Image.open('源图片.png').convert('RGBA')  # 替换为实际路径
sizes = [256, 128, 64, 48, 32, 16]

entries = []
for s in sizes:
    img = src.resize((s, s), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    entries.append((s, buf.getvalue()))

# 构建 ICO 二进制
header = struct.pack('<HHH', 0, 1, len(entries))
offset = 6 + 16 * len(entries)
ico_entries = b''
ico_data = b''
for s, data in entries:
    w = 0 if s == 256 else s
    h = 0 if s == 256 else s
    ico_entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(data), offset)
    ico_data += data
    offset += len(data)

with open('assets/app_icon.ico', 'wb') as f:
    f.write(header + ico_entries + ico_data)

print('Done!')
```

> **⚠️ 注意**：Pillow 自带的 `img.save('x.ico')` 在某些版本下生成的 ICO 不含 256×256 帧，请使用上述手动构建方式。

### 2.2 package.json 版本号

构建前确认 `package.json` 中 `version` 字段与你要发布的版本一致：

```jsonc
{
  "version": "1.0.0-beta.1", // ← 必须在构建前设置好
}
```

版本号命名规则见 [VERSION_CONVENTION.md](VERSION_CONVENTION.md)。

### 2.3 node_modules

```powershell
# 确保依赖已安装
npm install
# 或更严格的 CI 模式
npm ci
```

---

## 三、构建流程

### 3.1 一键构建

```powershell
cd "d:\VScode project\Neko_Status"
npm run build
# 等价于: npx electron-builder --win --x64
```

构建产物在 `dist/` 目录：

| 文件                                  | 大小（参考） | 说明                         |
| ------------------------------------- | ------------ | ---------------------------- |
| `NekoStatus-Setup-{ver}.exe`          | ~92 MB       | NSIS 安装包（推荐分发）      |
| `NekoStatus-{ver}-win.zip`            | ~127 MB      | 便携版 ZIP（免安装）         |
| `NekoStatus-Setup-{ver}.exe.blockmap` | ~100 KB      | 增量更新映射（可忽略）       |
| `builder-effective-config.yaml`       | —            | 构建配置快照                 |
| `win-unpacked/`                       | —            | 解压后的应用目录（中间产物） |

### 3.2 构建踩坑

#### 坑 1：首次构建下载 Electron 缓慢/失败

首次构建需下载 ~138MB 的 `electron-v40.8.0-win32-x64.zip`。如果网络不好：

```powershell
# 使用国内镜像
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run build
```

#### 坑 2：`dist/` 目录文件被占用

如果上一次构建的 `dist/win-unpacked/NekoStatus.exe` 正在运行（或被杀软锁定），构建会报错：

```
⨯ remove dist\win-unpacked\NekoStatus.exe: The process cannot access the file
```

**解决**：关闭正在运行的 NekoStatus 进程，清理 dist 后重试：

```powershell
Get-Process -Name "NekoStatus" -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
npm run build
```

#### 坑 3：签名警告

构建日志中出现 `signing with signtool.exe` 是 electron-builder 自动尝试签名，没有证书时**不影响构建**，但安装时会触发 Windows SmartScreen 拦截。用户点击「更多信息 → 仍要运行」即可。

---

## 四、生成 SHA256 校验文件

构建完成后，手动生成校验文件：

```powershell
cd "d:\VScode project\Neko_Status"
$ver = "1.0.0-beta.1"  # 替换为实际版本

$exe = Get-FileHash "dist\NekoStatus-Setup-$ver.exe" -Algorithm SHA256
$zip = Get-FileHash "dist\NekoStatus-$ver-win.zip" -Algorithm SHA256

$content = "$($exe.Hash.ToLower())  NekoStatus-Setup-$ver.exe`n$($zip.Hash.ToLower())  NekoStatus-$ver-win.zip"
Set-Content -Path "dist\SHA256SUMS.txt" -Value $content -NoNewline

# 验证
Get-Content "dist\SHA256SUMS.txt"
```

---

## 五、上传到 GitHub Release

### 5.1 前置：GitHub PAT Token 权限

**这是最大的坑之一。** GitHub Personal Access Token (PAT) 必须有以下权限：

| Scope      | 用途                           | 必需？                    |
| ---------- | ------------------------------ | ------------------------- |
| `repo`     | 读写私有仓库代码、创建 Release | ✅ 必须                   |
| `workflow` | 推送 `.github/workflows/` 文件 | ✅ 首次推送 CI 配置时必须 |

**如果 PAT 没有 `workflow` 权限**，`git push` 包含 `.github/workflows/` 的提交会被拒绝：

```
! [remote rejected] main -> main (refusing to allow a Personal Access Token
  to create or update workflow without `workflow` scope)
```

而且所有 GitHub API（包括低层 Git Data API: blobs/trees/commits）都**无法绕过**这个限制。

**创建/更新 PAT**：GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → 勾选 `repo` + `workflow`

### 5.2 提交代码、打 Tag、推送

```powershell
cd "d:\VScode project\Neko_Status"

# 1. 暂存所有变更（版本号、图标等）
git add -A
git commit -m "release: v1.0.0-beta.1"

# 2. 打 Tag
git tag v1.0.0-beta.1

# 3. 推送代码和 Tag
git push origin main --tags
```

### 5.3 创建 GitHub Release

```powershell
$token = "ghp_你的TOKEN"
$owner = "Neko-NF"
$repo  = "Neko-Status-Desktop"
$tag   = "v1.0.0-beta.1"

# 判断是否为预发布
$isPrerelease = $tag -match '-beta\.' -or $tag -match '-nightly\.'

$body = @{
  tag_name   = $tag
  name       = "$tag $(if($isPrerelease){'(Pre-Release)'}else{'(Stable)'})"
  body       = "## NekoStatus Desktop $tag`n`n更新内容：`n- 在此填写更新说明"
  prerelease = $isPrerelease
  draft      = $false
} | ConvertTo-Json -Depth 3

$headers = @{
  "Authorization" = "token $token"
  "Accept" = "application/vnd.github.v3+json"
}

$release = Invoke-RestMethod "https://api.github.com/repos/$owner/$repo/releases" `
  -Method POST -Headers $headers `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
  -ContentType "application/json; charset=utf-8"

Write-Host "Release URL: $($release.html_url)"
$releaseId = $release.id
Write-Host "Release ID:  $releaseId"
```

### 5.4 上传安装包到 Release

**⚠️ 重要踩坑：必须使用 `curl.exe` 上传大文件**

PowerShell 5.1 的 `Invoke-RestMethod` 上传 >50MB 文件时会**无限挂起**（已知 bug，内存中读取 byte array 后发送 HTTP request 时卡死）。必须使用 Windows 自带的 `curl.exe`：

```powershell
$token     = "ghp_你的TOKEN"
$releaseId = 294429145  # 替换为上一步返回的 Release ID
$uploadUrl = "https://uploads.github.com/repos/Neko-NF/Neko-Status-Desktop/releases/$releaseId/assets"

# 上传 EXE（~92MB，需等待几分钟）
curl.exe --progress-bar `
  -H "Authorization: token $token" `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@dist/NekoStatus-Setup-1.0.0-beta.1.exe" `
  "$uploadUrl`?name=NekoStatus-Setup-1.0.0-beta.1.exe"

# 上传 ZIP（~127MB）
curl.exe --progress-bar `
  -H "Authorization: token $token" `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@dist/NekoStatus-1.0.0-beta.1-win.zip" `
  "$uploadUrl`?name=NekoStatus-1.0.0-beta.1-win.zip"

# 上传 SHA256SUMS.txt（几 KB，秒传）
curl.exe --progress-bar `
  -H "Authorization: token $token" `
  -H "Content-Type: text/plain" `
  --data-binary "@dist/SHA256SUMS.txt" `
  "$uploadUrl`?name=SHA256SUMS.txt"
```

### 5.5 验证上传结果

```powershell
curl.exe -s `
  -H "Authorization: token $token" `
  -H "Accept: application/vnd.github.v3+json" `
  "https://api.github.com/repos/Neko-NF/Neko-Status-Desktop/releases/$releaseId" `
  | Select-String '"name":|"size":|"state":|"browser_download_url":'
```

每个 asset 的 `"state"` 应为 `"uploaded"`。

---

## 六、客户端更新源地址

### 6.1 更新源原理

客户端通过 GitHub Releases API 检查更新，地址格式：

```
https://api.github.com/repos/{owner}/{repo}/releases/latest    ← 稳定版
https://api.github.com/repos/{owner}/{repo}/releases?per_page=30  ← beta/nightly
```

### 6.2 内嵌默认更新源

在 [config-store.js](../src/main/config-store.js) 的 `DEFAULTS` 中已配置：

```javascript
githubOwner: 'Neko-NF',
githubRepo: 'Neko-Status-Desktop',
updateChannel: 'stable',   // 默认通道：stable / beta / nightly
```

**当前仓库**：`Neko-NF/Neko-Status-Desktop`（私有仓库）

### 6.3 用户下载/更新地址

| 用途                   | 地址                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Release 页面（浏览器） | `https://github.com/Neko-NF/Neko-Status-Desktop/releases`                                              |
| 最新稳定版 API         | `https://api.github.com/repos/Neko-NF/Neko-Status-Desktop/releases/latest`                             |
| 所有版本 API           | `https://api.github.com/repos/Neko-NF/Neko-Status-Desktop/releases`                                    |
| EXE 直接下载           | `https://github.com/Neko-NF/Neko-Status-Desktop/releases/download/v{版本}/NekoStatus-Setup-{版本}.exe` |
| ZIP 直接下载           | `https://github.com/Neko-NF/Neko-Status-Desktop/releases/download/v{版本}/NekoStatus-{版本}-win.zip`   |

> **注意**：私有仓库需要用户在客户端设置中填写 GitHub Token (PAT)，或将仓库改为 Public。

### 6.4 如果迁移仓库

只需修改 `config-store.js` 中的 `githubOwner` 和 `githubRepo` 默认值，重新构建发布即可。已安装的用户也可在设置页手动修改。

---

## 七、CI/CD 自动构建（GitHub Actions）

一旦 `.github/workflows/release.yml` 推送成功，后续发版只需：

```powershell
# 改版本号 → 提交 → 打 Tag → 推送
# GitHub Actions 会自动构建并发布 Release

git tag v1.0.1
git push origin v1.0.1
# 几分钟后 Release 页面自动出现新版本
```

**CI 构建避免了手动构建的所有坑**（图标、环境、上传），强烈推荐使用。

### CI 首次使用检查清单

- [ ] 仓库 Settings → Actions → General → Workflow permissions → **Read and write permissions**
- [ ] `assets/app_icon.ico` 已提交到仓库且包含 256×256
- [ ] `package.json` 版本号已更新
- [ ] PAT 有 `workflow` scope（否则 workflow 文件推送不上去）

---

## 八、踩坑总结速查表

| #   | 坑                        | 现象                                                        | 解决方案                                                   |
| --- | ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | ICO 尺寸不够              | `⨯ image must be at least 256x256`                          | 用 Python 脚本生成含 256×256 的 ICO                        |
| 2   | PAT 缺 workflow scope     | `refusing to allow a PAT to create or update workflow`      | 重新生成 PAT，勾选 `workflow`                              |
| 3   | Git Data API 也无法绕过   | 低层 API (blobs/trees) 创建含 workflow 路径的 tree 返回 404 | **没有 workaround**，必须有 `workflow` scope               |
| 4   | PowerShell 上传大文件挂死 | `Invoke-RestMethod` 上传 >50MB 文件无限等待                 | 改用 `curl.exe`（Windows 自带）                            |
| 5   | dist 文件被占用           | `The process cannot access the file`                        | 先关闭 NekoStatus 进程，再 `Remove-Item dist`              |
| 6   | Electron 下载中断         | `cannot unpack electron zip file, will be re-downloaded`    | 设置 `ELECTRON_MIRROR` 使用国内镜像                        |
| 7   | 首次 npx 运行慢           | `Need to install electron-builder@26.x` 提示                | 正常现象，全局 cache 后第二次秒启                          |
| 8   | SmartScreen 拦截          | 安装包运行时弹出警告                                        | 用户点「更多信息 → 仍要运行」；长期：购买代码签名证书      |
| 9   | 私有仓库更新 403          | 客户端检查更新返回 403                                      | 用户需在设置填写 GitHub PAT（scope: `repo`），或改公开仓库 |

---

## 九、完整发版检查清单（Checklist）

```plaintext
发版前：
  □ package.json version 已更新（如 1.0.0-beta.1）
  □ assets/app_icon.ico 存在且含 256×256
  □ npm install / npm ci 无报错
  □ config-store.js 中 githubOwner/githubRepo 正确

构建：
  □ npm run build 成功
  □ dist/ 中有 .exe 和 .zip
  □ 运行安装包测试安装/卸载

发布：
  □ git commit + git tag vX.Y.Z[-beta.N]
  □ git push origin main --tags
  □ GitHub Release 已创建（CI 自动 或 手动 curl 上传）
  □ Release assets 均为 state=uploaded
  □ SHA256SUMS.txt 已上传

验证：
  □ 在另一台机器或新目录下载安装包测试
  □ 客户端「检查更新」能发现新版本
  □ 下载 → SHA256 校验通过 → 安装成功
```
