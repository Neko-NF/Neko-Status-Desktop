# 测试规范

## 当前测试命令

```bash
npm test
npm run test:watch
npm run test:coverage
npm run verify
```

## 当前覆盖范围

当前测试是最小工程化基线，重点覆盖：

- shared IPC 契约
- shared schema 校验
- 配置默认值与合并逻辑
- 文本文件编码污染扫描

## 当前策略

- 使用 Node 内置测试运行器
- 优先覆盖纯函数、共享模块、配置规则
- 避免一开始就把 Electron 原生能力塞进测试
- `npm run verify` 会扫描常见 UTF-8/GBK 乱码特征；如果 Windows 终端显示乱码，但该检查通过，优先怀疑终端输出编码而不是文件已损坏

## 新增测试的建议

优先顺序：

1. `shared` 纯函数
2. `main` 层可脱离 Electron 的 helper
3. `preload` 方法映射
4. renderer 纯状态逻辑

## 提交前要求

- `npm run verify` 必须通过
- 涉及新 schema、配置、IPC 契约时，必须补对应测试
- 新增或批量修改中文文档、UI 文案、PowerShell 输出解析逻辑后，必须确认编码污染扫描仍通过
