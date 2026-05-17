# Contributing

## 本地开发

```bash
npm ci
npm start
```

常用命令：

```bash
npm run lint
npm test
npm run verify
npm run build
```

## 分支建议

- `feature/*`
- `fix/*`
- `refactor/*`
- `docs/*`

## Commit 建议

```text
feat: ...
fix: ...
refactor: ...
docs: ...
chore: ...
```

## PR 要求

- 说明改动范围和目的
- 说明验证方式
- 如涉及 UI，附截图或说明
- 如涉及 IPC、配置、发布流程，明确标记
- 如涉及中文文案、文档或 Windows 输出解析，确认 `npm run verify` 的编码污染扫描通过

## Review 检查清单

- 是否继续扩大了 `main.js` / `app.js` / `app-ipc.js` 的耦合
- 是否新增了未文档化的 IPC 或配置
- 是否补了最小测试
- 是否同步更新了对应文档
- 是否出现疑似 UTF-8/GBK 乱码或终端编码误判
