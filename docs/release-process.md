# 发布流程概览

> 本文件是发布入口索引。完整步骤、排障和注意事项以 [RELEASE_WORKFLOW.md](./RELEASE_WORKFLOW.md) 为准。

## 当前链路

1. 更新 `package.json` 版本号，并确认 tag 将与该版本一致。
2. 更新 `release_notes.txt` 作为本次 GitHub Release 草稿。
3. 运行 `npm run verify`。
4. 运行 `npm run build`，本地确认 NSIS 与 ZIP 产物可生成。
5. 提交版本变更并创建 `v*` tag。
6. 推送 tag，GitHub Actions 执行正式 Release workflow。

## 质量门禁

- PR 阶段：`ci.yml` 运行 `npm run verify`，`build-check.yml` 在 Windows 上运行完整 `npm run build` 并上传安装包/ZIP。
- 发布阶段：`release.yml` 仅允许从 `v*` tag 发布，并校验 tag 版本与 `package.json` version 一致。
- Release 产物必须包含安装包、ZIP 和 `SHA256SUMS.txt`。

## 发布通道

- `stable`：正式 tag，例如 `v1.2.6`。
- `beta`：预发布 tag，例如 `v1.3.0-beta.1`。
- `nightly`：保留命名规则，例如 `v1.3.0-nightly.20260517`；当前未启用自动定时发布。
