# 发布流程概览

## 当前链路

1. 本地修改代码与 `release_notes.txt`
2. 运行 `npm run verify`
3. 运行 `npm run build`
4. 提交版本变更并打 tag
5. 推送 tag
6. GitHub Actions 生成 Release 与安装包

## 质量门

- PR 阶段：`ci.yml` + `build-check.yml`
- 发布阶段：`release.yml` 先执行 `npm run verify`，再构建正式产物

## 渠道

- `stable`
- `beta`
- `nightly`：仅保留命名规则，未启用自动定时发布
