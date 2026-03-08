# Neko Status — 版本号规范与更新通道说明

> **适用范围**：Neko Status Electron 桌面客户端  
> **最后更新**：2026-03-09

---

## 一、版本号格式（Semantic Versioning）

所有版本号遵循 **语义化版本 2.0.0**（[semver.org](https://semver.org/)），格式如下：

```
v{MAJOR}.{MINOR}.{PATCH}[-{channel}.{N}]
```

| 段位                | 说明                               | 示例                     |
| ------------------- | ---------------------------------- | ------------------------ |
| `MAJOR`             | 破坏性变更（API 或行为不兼容旧版） | `2.0.0`                  |
| `MINOR`             | 新增功能，向后兼容                 | `1.1.0`                  |
| `PATCH`             | Bug 修复、小优化，向后兼容         | `1.0.1`                  |
| `-beta.N`           | Beta 预发布，公测阶段，N 从 1 累加 | `1.1.0-beta.2`           |
| `-nightly.YYYYMMDD` | Nightly 日构建，最不稳定           | `1.2.0-nightly.20260310` |

### 版本号增量规则

```
主版本 (MAJOR)  — 架构级重构、协议破坏性变更
次版本 (MINOR)  — 新增完整功能模块（如：媒体检测、三通道更新）
补丁版本 (PATCH) — Bug 修复、依赖升级、UI 小调整
```

**禁止跳版**：Patch 不得跳 Minor，Minor 不得跳 Major（例如 `v1.0.0 → v1.2.0` 不允许跳过 `v1.1.0`）。

---

## 二、三更新通道

如图所示，客户端支持三个更新通道，用户可在「更新中心」自由切换：

```
┌─────────────────────────────────────────────┐
│  (•) 更新通道                                │
│                                             │
│  ◉  稳定版  ● 经完整测试，推荐生产使用       │
│  ○  Beta   ●  新功能抢先体验，可能含小问题   │
│  ○  Nightly ● 最新开发构建，仅供测试         │
└─────────────────────────────────────────────┘
```

### 通道对照表

| 通道    | 配置值    | 接受的 Tag 格式           | GitHub Release 类型                 | 稳定性 |
| ------- | --------- | ------------------------- | ----------------------------------- | ------ |
| 稳定版  | `stable`  | `v1.0.0`                  | 正式 Release（`prerelease: false`） | ★★★★★  |
| Beta    | `beta`    | `v1.1.0-beta.1`           | Pre-Release                         | ★★★☆☆  |
| Nightly | `nightly` | `v1.2.0-nightly.20260310` | Pre-Release                         | ★★☆☆☆  |

### 通道继承原则

- **稳定版** 只能升级到更高的稳定版。
- **Beta** 可以接收稳定版 + Beta 版更新（向后兼容）。
- **Nightly** 可以接收所有版本（稳定 + Beta + Nightly）。

---

## 三、Git Tag 命名规则

推送 Tag 会触发 GitHub Actions 自动构建并发布 Release。

```bash
# 稳定版
git tag v1.0.0
git push origin v1.0.0

# Beta 版
git tag v1.1.0-beta.1
git push origin v1.1.0-beta.1

# Nightly 版（通常由 CI 定时自动创建）
git tag v1.2.0-nightly.20260310
git push origin v1.2.0-nightly.20260310
```

**Tag 规则摘要：**

| 规则                           | 正确 ✅                        | 错误 ❌                         |
| ------------------------------ | ------------------------------ | ------------------------------- |
| 必须以 `v` 开头                | `v1.0.0`                       | `1.0.0`                         |
| MAJOR / MINOR / PATCH 均为整数 | `v1.2.3`                       | `v1.2`                          |
| Beta 后缀格式                  | `v1.1.0-beta.1`                | `v1.1.0-beta` / `v1.1.0b1`      |
| Nightly 后缀格式               | `v1.2.0-nightly.20260310`      | `v1.2.0-nightly` / `v1.2.0-dev` |
| 同 MINOR 内 Beta 序号递增      | `beta.1` → `beta.2` → `v1.1.0` | 重置为 `beta.1` 后直接正式发布  |

---

## 四、`package.json` 版本号管理

`package.json` 中的 `version` 字段决定：

- 应用内显示的版本号（`app.getVersion()`）
- 构建产物名称（如 `NekoStatus-Setup-1.0.0.exe`）
- GitHub Actions 读取并写入 Release Tag 名称

**发版前必须同步修改 `package.json` 版本号**：

```bash
# 使用 npm 内置工具（自动修改 package.json 并 commit）
npm version patch   # 例：1.0.0 → 1.0.1
npm version minor   # 例：1.0.0 → 1.1.0
npm version major   # 例：1.0.0 → 2.0.0

# Beta：手动编辑 package.json version 字段为 1.1.0-beta.1
```

---

## 五、GitHub Release 发布规范

### Release 标题格式

```
Neko Status v{version}          # 稳定版
Neko Status v{version} [Beta]   # Beta 版
Neko Status v{version} [Nightly {date}]  # Nightly
```

### Release 产物命名（由 electron-builder 自动生成）

| 产物文件                         | 说明                           |
| -------------------------------- | ------------------------------ |
| `NekoStatus-Setup-{version}.exe` | NSIS 安装包（推荐用户使用）    |
| `NekoStatus-{version}-win.zip`   | ZIP 便携包（覆盖更新或绿色版） |
| `SHA256SUMS.txt`                 | 文件完整性校验摘要             |

### Release body 模板

```markdown
## Neko Status v{version}

> 频道：稳定版 / Beta / Nightly

### 更新摘要

- xxx
- xxx

### 安装说明

- **推荐**：下载 `NekoStatus-Setup-{version}.exe` 双击安装
- **覆盖更新**：下载 `.zip` 解压后覆盖安装目录

### 文件完整性（SHA256）

| 文件                           | SHA256      |
| ------------------------------ | ----------- |
| NekoStatus-Setup-{version}.exe | `abc123...` |
| NekoStatus-{version}-win.zip   | `def456...` |
```

---

## 六、版本检查逻辑（客户端）

客户端根据配置的 `updateChannel` 决定检查哪个通道的最新版本：

```javascript
// 通道 stable  → GET /repos/.../releases/latest
//               （GitHub 默认返回最新非 pre-release）
//
// 通道 beta    → GET /repos/.../releases
//               过滤：tag 含 -beta 或为纯稳定版，取最新
//
// 通道 nightly → GET /repos/.../releases
//               过滤：所有 tag，取绝对最新
```

版本比较遵循 semver，pre-release 版本低于正式版：
`v1.1.0-nightly.20260310 < v1.1.0-beta.2 < v1.1.0 < v1.2.0-beta.1`

---

## 七、快速参考卡

```
当前版本: 1.0.0（稳定版，见 package.json）

发下一个 Bug 修复:
  1. 修复 Bug
  2. npm version patch → 1.0.1
  3. git push origin v1.0.1
  4. CI 自动构建 → GitHub Release

发下一个 Beta:
  1. 实现功能
  2. package.json version → "1.1.0-beta.1"
  3. git tag v1.1.0-beta.1 && git push origin v1.1.0-beta.1
  4. CI 构建 → pre-release

升为正式版:
  1. 测试完毕
  2. npm version minor → 1.1.0
  3. git push origin v1.1.0
  4. CI 构建 → 正式 release
```
