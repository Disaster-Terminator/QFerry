# QFerry

<img alt="interface MCP + CLI" src="https://img.shields.io/badge/interface-MCP%20%2B%20CLI-4B5563"> <img alt="license Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-0F766E"> <img alt="status read-only preview-first" src="https://img.shields.io/badge/status-read--only%20%2B%20preview--first-2563EB">

QFerry 是一个面向 QQ 邮箱的 Gmail-like 邮箱整理工具。当前重点不是“帮你写邮件”，而是让 Codex / ChatGPT 风格的 agent 能安全地读取、分类、识别和规划处理已有邮件。

当前优先产品形态是 **Codex 插件**。ChatGPT App / GPT App 方向保留，但浏览器连接、HTTPS tunnel、widget 和提交审核暂时冻结。

## 当前能力

- 通过 Codex plugin-local MCP runtime 启动邮箱工具。
- 读取 QQ 邮箱文件夹列表。
- 对 QQ 邮箱执行小批量、只读 metadata 扫描。
- 对 fixture provider 执行分类和 preview-only cleanup plan。
- 为每次 e2e 写入可追踪日志和 summary。
- 默认禁止真实邮箱写操作。

已验证的 QQ read-only 路径：

```text
plugin .mcp.json -> node ./dist/mcp.cjs -> MCP tools -> QQ IMAP read-only
```

## 安全边界

默认允许：

- `list_mailboxes`
- `get_capability_snapshot`
- bounded `search`
- fixture `classify_messages`
- fixture `plan_cleanup`

默认禁止：

- 移动真实 QQ 邮件
- 标记已读/未读
- 创建或删除 QQ 文件夹
- 删除邮件
- 发送邮件
- 下载附件
- 全量扫描邮箱

所有真实 QQ 邮箱测试都必须保持 `mutationsAttempted: 0`。

## 本地开发

要求：

- Node 使用 `pnpm`
- Python 使用 `uv`

安装依赖：

```powershell
pnpm install
```

完整检查：

```powershell
rtk pnpm run check
rtk uv run python -m unittest tests.test_probe_qqmail
```

插件 e2e：

```powershell
rtk pnpm qferry:e2e:plugin-fixture
rtk pnpm qferry:e2e:plugin-qq-readonly
```

QQ read-only e2e 需要本地 `.env`：

```text
QQMAIL_EMAIL=your@qq.com
QQMAIL_KEY=your-qq-mail-authorization-code
QQMAIL_METADATA_SAMPLE_LIMIT=1
```

`.env`、`logs/`、`artifacts/` 不应提交。

## Codex 插件

插件目录：

```text
plugins/qferry/
  .codex-plugin/plugin.json
  .mcp.json
  dist/mcp.cjs
  skills/qferry/SKILL.md
```

插件 runtime 必须从 plugin-local `./dist/mcp.cjs` 启动。不要把 `.mcp.json` 指向源码 checkout。

构建/校验插件 runtime：

```powershell
rtk pnpm run sync:qferry-plugin
rtk pnpm run verify:qferry-plugin
```

## 测试留痕

每次 e2e 都会写入：

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
```

这些文件用于验收和回溯，不提交到仓库。

## 开源许可证

QFerry 使用 Apache License 2.0。

```text
Copyright 2026 RayStorm
SPDX-License-Identifier: Apache-2.0
```

英文引用：

> Licensed under the Apache License, Version 2.0.

## 当前状态

仓库已按开源公开方向整理。公开并在本机 Codex 中部署 `plugins/qferry` 后，下一步是继续做真实插件发现/调用验收。
