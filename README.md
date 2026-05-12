# QFerry

<p align="left">
  <img alt="runtime Node.js 20+" src="https://img.shields.io/badge/runtime-Node.js%2020%2B-339933">
  <img alt="language TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6">
  <img alt="package manager pnpm" src="https://img.shields.io/badge/package%20manager-pnpm-F69220">
  <img alt="interface MCP + CLI" src="https://img.shields.io/badge/interface-MCP%20%2B%20CLI-4B5563">
  <img alt="mail QQ Mail" src="https://img.shields.io/badge/mail-QQ%20Mail-2563EB">
  <img alt="safety read-only preview-first" src="https://img.shields.io/badge/safety-read--only%20%2B%20preview--first-0F766E">
  <img alt="license Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-0F766E">
</p>

**QFerry 是一个面向 QQ 邮箱的 Gmail-like 邮箱整理工具。**

当前目标不是“帮你写邮件”，而是让 Codex / ChatGPT 风格的 agent 安全地读取、分类、识别和规划处理已有邮件。现在优先交付 **Codex 插件**；ChatGPT App / GPT App 方向保留，但浏览器连接、HTTPS tunnel、widget 和提交审核暂时冻结。

```text
Codex
  -> QFerry Codex Plugin
    -> plugin-local MCP runtime
      -> fixture provider 或 QQ Mail read-only provider
    -> trace logs + e2e artifacts
```

## 快速开始

通过 Codex 插件市场添加 QFerry：

```powershell
codex plugin marketplace add Disaster-Terminator/QFerry
```

然后打开 Codex，运行 `/plugins`，按键盘右方向键切到 `[QFerry Local]` 插件市场，按 Enter 打开 `QFerry` 详情页，选择 `Install plugin`。

安装后重新打开 Codex，然后让 Codex 使用 QFerry：

```text
Use QFerry to list QQ Mail folders safely. Do not mutate any real mailbox data.
```

默认插件配置使用 fixture provider，不需要 QQ 邮箱授权码也能验证插件能启动和暴露工具。需要连接真实 QQ 邮箱时，在你的本机环境里配置：

```text
QQMAIL_EMAIL=your@qq.com
QQMAIL_KEY=your-qq-mail-authorization-code
QQMAIL_METADATA_SAMPLE_LIMIT=1
```

`QQMAIL_KEY` 是 QQ 邮箱 IMAP/SMTP 授权码，不是 QQ 登录密码。真实 QQ 邮箱路径默认只读，必须保持 `mutationsAttempted: 0`。

说明：Codex CLI 的 `codex plugin marketplace add` 只添加插件市场；插件安装在 Codex TUI 的 `/plugins` 里完成。

## 预期结果

- Codex 能看到 QFerry skill。
- QFerry MCP server 从插件目录里的 `./dist/mcp.cjs` 启动。
- fixture provider 可调用 `list_mailboxes`、`search`、`classify_messages`、`plan_cleanup`。
- QQ Mail read-only provider 可调用 `get_capability_snapshot`、`list_mailboxes` 和 bounded `search`。
- 每次 e2e 留下 trace artifacts，方便验收回溯。

## 当前能力

| 能力 | 说明 |
| --- | --- |
| 文件夹读取 | 读取 QQ 邮箱文件夹列表 |
| 小批量扫描 | 对 QQ 邮箱执行 bounded metadata search |
| 分类规则 | 用自定义规则把邮件归入用户定义的 group |
| 清理计划 | 生成 preview-only cleanup plan，不直接修改真实邮箱 |
| 测试留痕 | 写入 jsonl trace 和 Markdown summary |
| 安全边界 | 默认禁止真实邮箱写操作 |

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

所有真实 QQ 邮箱测试都必须保持：

```text
mutationAllowed: false
mutationsAttempted: 0
QQMAIL_METADATA_SAMPLE_LIMIT=1
```

## 测试留痕

每次 e2e 都会写入：

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
```

这些文件用于验收和回溯，不提交到仓库。

## 开发者文档

普通安装优先看本 README。开发、验收和插件结构细节见 [QFerry Codex 插件安装与验收](docs/CODEX_PLUGIN_ACCEPTANCE.md)。

常用开发检查：

```powershell
rtk pnpm run check
rtk uv run python -m unittest tests.test_probe_qqmail
```

插件 e2e：

```powershell
rtk pnpm qferry:e2e:plugin-fixture
rtk pnpm qferry:e2e:plugin-qq-readonly
```

## License

QFerry 使用 Apache License 2.0。

```text
Copyright 2026 RayStorm
SPDX-License-Identifier: Apache-2.0
```

English reference:

> Licensed under the Apache License, Version 2.0.
