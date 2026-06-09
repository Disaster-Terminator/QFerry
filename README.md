# QFerry

<p align="left">
  <img alt="runtime Node.js 20+" src="https://img.shields.io/badge/runtime-Node.js%2020%2B-339933">
  <img alt="language TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178C6">
  <img alt="package manager pnpm" src="https://img.shields.io/badge/package%20manager-pnpm-F69220">
  <img alt="interface MCP + CLI" src="https://img.shields.io/badge/interface-MCP%20%2B%20CLI-4B5563">
  <img alt="mail QQ Mail" src="https://img.shields.io/badge/mail-QQ%20Mail-2563EB">
  <img alt="safety preview-first approval-required" src="https://img.shields.io/badge/safety-preview--first%20%2B%20approval--required-0F766E">
  <img alt="license Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-0F766E">
</p>

**QFerry 是一个面向 QQ 邮箱的 Gmail-like 邮箱整理工具。**

当前目标不是“帮你写邮件”，而是让 Codex / ChatGPT 风格的 agent 安全地读取、分类、识别和规划处理已有邮件。现在优先交付 **Codex 插件**；ChatGPT App / GPT App 方向保留，但浏览器连接、HTTPS tunnel、widget 和提交审核暂时冻结。

```text
Codex
  -> QFerry Codex Plugin
    -> plugin-local MCP runtime
      -> fixture provider 或 QQ Mail provider
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

也可以把非密钥配置放到本机 JSON 文件，并用 `QFERRY_CONFIG_FILE` 指向它：

```json
{
  "provider": "qqmail",
  "qqmail": {
    "email": "your@qq.com",
    "imapHost": "imap.qq.com",
    "imapPort": 993,
    "metadataSampleLimit": 1
  }
}
```

`QQMAIL_KEY` 是 QQ 邮箱 IMAP/SMTP 授权码，不是 QQ 登录密码。它只通过环境变量提供，不写入本机 JSON、仓库、trace 或 summary。真实 QQ 邮箱默认走 read-only / preview-first 工作流；任何真实移动邮件都必须先生成 preview plan，经用户明确授权后调用 `confirm_cleanup_plan`，再用同一个 `operationPlanId` 调用 `execute_cleanup`。

说明：Codex CLI 的 `codex plugin marketplace add` 只添加插件市场；插件安装在 Codex TUI 的 `/plugins` 里完成。

## 预期结果

- Codex 能看到 QFerry skill。
- QFerry MCP server 通过插件目录里的 `./mcp-bootstrap.mjs` 启动，再加载 plugin-local `./dist/mcp.cjs`。
- `mcp-bootstrap.mjs` 会把运行 cwd 切到用户状态目录，避免 Windows 下 MCP 进程占住插件缓存目录，导致插件详情、升级或卸载失败。
- fixture provider 可调用 `get_status`、`list_mailboxes`、`get_mailbox_summary`、`search`、`classify_messages`、`triage_inbox`、`group_spam_candidates`、`ruleset_governance_preview`、`classification_sweep`、`classification_map`、`plan_cleanup`。
- QQ Mail provider 可调用 `get_status`、`get_capability_snapshot`、`list_mailboxes`、`get_mailbox_summary`、bounded `search`、按 UID `fetch`、`triage_inbox`、`ruleset_governance_preview`、`classification_sweep`、`classification_map` 和 `group_spam_candidates`。
- 每次 e2e 留下 trace artifacts，方便验收回溯。

## 当前能力

| 能力 | 说明 |
| --- | --- |
| 文件夹读取 | 读取 QQ 邮箱文件夹列表 |
| 文件夹摘要 | 只读读取文件夹邮件数量，类似 Gmail label counts |
| 小批量扫描 | 对 QQ 邮箱执行 bounded metadata search |
| 单封读取 | 按 `folder + uid + uidValidity` 精确读取选中邮件 metadata，不靠 bounded scan 回查 |
| 分类规则 | 用内联规则或 `qferry.rules.json` 把邮件归入用户定义的 group；group 可选绑定自定义目标文件夹 |
| 收件箱整理报告 | `triage_inbox` 汇总 groupCounts、样本数、建议下一步 |
| 垃圾/广告候选 | `group_spam_candidates` 从最旧 metadata 开始分组明显垃圾/广告，先给用户确认 |
| 规则集治理预览 | `ruleset_governance_preview` 应用用户规则集，按自定义 group 和目标文件夹生成一组 preview-only operation plans |
| Legacy 分类扫描 | `classification_sweep` 用内置启发式逐块扫描，只返回聚合分类计数、chunk 摘要和 `hasMore` / `resumeToken` / `nextScanOffset`，不生成操作计划 |
| Legacy 分类地图 | `classification_map` 对选中窗口按内置启发式分桶，并给出建议动作，不生成操作计划 |
| 清理计划 | 基于规则文件生成 preview-only cleanup plan，不直接修改真实邮箱 |
| 测试留痕 | 写入 jsonl trace 和 Markdown summary |
| 安全边界 | 默认 read-only / preview-first；真实写操作需要用户授权和服务端确认 plan |

规则文件示例见 [examples/qferry.rules.json](examples/qferry.rules.json)。规则文件包含 `version`、`defaultGroupId`、`groups` 和 `rules`，group 可选配置 `target.folder`。`ruleset_governance_preview` 是当前推荐的高吞吐治理入口：它会按用户定义的 group 聚合匹配结果，并为每个带目标文件夹的 group 生成单独的 preview plan。`preview_cleanup_batch` 仍可用于选定 group 的单计划预览；当它只选中一个带目标文件夹的 group 且没有显式传入 `target` 时，QFerry 会从规则文件推导移动目标，并把 `selectedGroupTargets` 写入 e2e summary，方便审计。

## 安全边界

默认允许：

- `list_mailboxes`
- `get_capability_snapshot`
- bounded `search`
- fixture `classify_messages`
- fixture `plan_cleanup`

默认禁止：

- 未经明确授权和服务端确认 plan 就移动真实 QQ 邮件
- 标记已读/未读
- 创建或删除 QQ 文件夹
- 删除邮件
- 发送邮件
- 下载附件
- 全量扫描邮箱

真实 QQ read-only 测试必须保持：

```text
mutationsAttempted: 0
QQMAIL_METADATA_SAMPLE_LIMIT=1
```

真实 mutation e2e 只用于用户明确授权的小批量验证，必须在 trace 和 summary 中记录 preview plan、`confirm_cleanup_plan`、`execute_cleanup`、目标文件夹和 `mutationsAttempted`。

`get_status` 会同时暴露兼容字段 `mutationAllowed`、当前可用性字段 `authConfigured` / `providerReady` / `mutationOperationallyReady`，以及 `mutationCapable` / `mutationRequiresConfirmation`。真实 QQ 邮箱只有在凭据齐全时才报告当前 mutation 可用；任何 mutation 都仍需要 preview plan、用户确认和 server-side `operationPlanId`。

Gmail-like 治理优先从用户规则集开始：先用 `search` / `sender_breakdown` / `plan_sender_governance` 发现稳定 sender、domain、subject 或 snippet 特征，沉淀到 `qferry.rules.json` 的自定义 group 和 `target.folder`；再用 `ruleset_governance_preview` 一次性按 group 生成可审计 preview plans。`plan_high_yield_governance` / `plan_mailbox_governance_campaign` 只返回紧凑候选和 patch 摘要；`apply_ruleset_patch` dry-run 也默认紧凑，只有显式传 `includeRenderedDraft: true` 时才回传完整规则草案，避免大规则集反复占用上下文。`classification_sweep`、`classification_map` 和 `bulk_governance_preview` 保留为 legacy discovery helpers，适合探索未知邮箱结构，不再作为推荐主流程。真实执行只用于确认后的计划子集，不把大范围 dry-run 等同于无人值守清理。

QQ IMAP 在多轮移动后可能重新折叠 sequence 窗口和收件箱 `exists` 计数。QFerry 因此把 sweep 结果视为导航信号，把 `ruleset_governance_preview` / `bulk_governance_preview` 返回的 UID refs、`selectedMessageRefs` 和 `mailboxSnapshot` 作为真实执行依据；移动后的硬校验以目标文件夹增量为准，源文件夹 delta 进入审计日志但不单独判失败。

## 测试留痕

每次 e2e 都会写入：

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
```

这些文件用于验收和回溯，不提交到仓库。

## 开发者文档

普通安装优先看本 README。开发、验收和插件结构细节见 [QFerry Codex 插件安装与验收](docs/CODEX_PLUGIN_ACCEPTANCE.md)。本地热迭代和终端治理入口见 [QFerry CLI](docs/CLI.md)。

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
