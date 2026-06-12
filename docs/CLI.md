# QFerry CLI

QFerry CLI 是本仓库的本地热迭代入口，用来绕开 MCP 插件开发时必须重启 Codex 才能刷新工具 schema/runtime 的问题。

CLI 复用 `@qferry/core`，不复制分类器、不绕过安全策略。当前版本只覆盖只读、preview 和本地规则文件 patch：

- 可以读取运行状态、文件夹列表和文件夹摘要。
- 可以对 bounded metadata 窗口做 high-yield governance 规划。
- 可以用 JSON 输入生成 ruleset governance preview / campaign preview。
- 可以把 discovery、ruleset patch 校验/应用和 campaign preview 串成一个 `campaign-workflow`。
- 可以 dry-run 或显式 `--apply` 本地 `qferry.rules.json` patch。
- 不确认、不执行真实邮箱移动；真实 mutation 仍保留在 preview + 用户确认链路中。

## 常用命令

在仓库根目录运行：

```powershell
rtk pnpm run qferry:cli -- status
rtk pnpm run qferry:cli -- list-mailboxes
rtk pnpm run qferry:cli -- mailbox-summary --folder INBOX
```

对一个文件夹做高收益 sender/domain 发现：

```powershell
rtk pnpm run qferry:cli -- high-yield `
  --run-id qferry-cli-inbox-high-yield `
  --folder INBOX `
  --page-size 50 `
  --max-pages 10 `
  --min-message-count 10 `
  --group-id advertising_marketing `
  --group-label 广告营销 `
  --target-folder 广告营销
```

当 discovery 返回 `break_down_sender`，或看到 `qq.com` 这类混合域时，用 sender breakdown 拆到具体发信人，而不是直接起草 domain 规则：

```powershell
rtk pnpm run qferry:cli -- sender-breakdown `
  --run-id qferry-cli-inbox-qq-breakdown `
  --folder INBOX `
  --from-domain-includes qq.com `
  --page-size 50 `
  --max-pages 5 `
  --max-sender-candidates 20 `
  --group-id qq_mail_system `
  --group-label QQ邮箱系统 `
  --target-folder QQ邮箱系统
```

`sender-breakdown` 是只读命令，不创建 operation plan。它返回具体 sender 候选和 sender-level suggested rules，适合后续手动选择 `plan_sender_governance.selectedFromIncludes` 或本地 ruleset patch。

复杂 preview 建议写 JSON 输入，避免命令行参数变成第二套 schema：

```json
{
  "runId": "qferry-cli-ruleset-preview",
  "folder": "INBOX",
  "pageSize": 50,
  "maxPages": 10,
  "maxMessageRefsPerGroup": 100,
  "action": "move",
  "rulesFile": "C:\\Users\\Disas\\AppData\\Local\\qferry\\qferry.rules.json"
}
```

然后运行：

```powershell
rtk pnpm run qferry:cli -- ruleset-preview --input .\preview.json
rtk pnpm run qferry:cli -- ruleset-campaign-preview --input .\campaign-preview.json
```

## Campaign Workflow

`campaign-workflow` 是大范围 dry-run 的首选热迭代入口。它复用 core 的三段能力：

1. `planMailboxGovernanceCampaign`：跨多个显式文件夹发现高收益 sender/domain 规则候选。
2. `applyRulesetPatchDraft`：校验候选规则 patch，默认 dry-run；只有 `applyRulesetPatch: true` 才写本地规则文件。
3. `rulesetGovernanceCampaignPreview`：用当前 ruleset 生成多文件夹 compact preview 和 operation plan 摘要。

示例输入：

```json
{
  "runId": "qferry-cli-campaign-workflow-inbox",
  "folders": ["INBOX", "其他文件夹/GitHub通知"],
  "pageSize": 50,
  "maxPagesPerFolder": 10,
  "order": "oldest",
  "minMessageCount": 10,
  "maxCandidatesPerFolder": 8,
  "maxDistinctSendersForDomainRule": 2,
  "maxConcurrentFolders": 3,
  "rulesFile": "C:\\Users\\Disas\\AppData\\Local\\qferry\\qferry.rules.json",
  "ruleGroup": {
    "id": "advertising_marketing",
    "label": "广告营销",
    "target": { "folder": "广告营销" }
  },
  "breakdownMixedDomains": {
    "enabled": true,
    "draftSenderRules": true,
    "maxDomains": 5,
    "maxSenderCandidatesPerDomain": 20,
    "minSenderMessageCount": 2
  },
  "applyRulesetPatch": false,
  "preview": {
    "enabled": true,
    "action": "move",
    "maxMessageRefsPerGroup": 100,
    "selectedGroupIds": ["advertising_marketing"],
    "maxUnplannedHintsPerFolder": 5
  }
}
```

运行：

```powershell
rtk pnpm run qferry:cli -- campaign-workflow --input .\workflow.json
```

注意：

- `applyRulesetPatch: false` 只校验 patch，不写 ruleset。
- `applyRulesetPatch: true` 只写本地 `qferry.rules.json`，不会移动、删除、标记真实邮件。
- workflow 不调用 `confirm_cleanup_plan` 或 `execute_cleanup`。
- preview 必须提供 `rulesFile`，避免在 CLI 里生成不可复用的一次性分类。
- 如果 discovery 遇到混合域，输出会包含 `mixedDomainNextSteps`，直接给出建议的 `sender-breakdown` 命令。
- `breakdownMixedDomains.enabled: true` 会在同一次 workflow 里只读拆分这些混合域；默认只返回 sender-level 候选证据，不移动真实邮件，也不把候选吸附进当前分类。
- `breakdownMixedDomains.draftSenderRules: true` 才会把候选 sender-level suggested rules 合并进本地 ruleset patch，适用于当前 `ruleGroup` 已经是明确分类目标的场景。
- `applyRulesetPatch: false` 时，如果 workflow 产生了 dry-run ruleset patch，preview 会使用内存中的草案规则估算覆盖和 operation plan，不要求先写入本地 ruleset 再跑第二轮。

本地规则 patch：

```powershell
rtk pnpm run qferry:cli -- apply-ruleset-patch `
  --rules-file C:\Users\Disas\AppData\Local\qferry\qferry.rules.json `
  --patch-file .\patch.json
```

默认是 dry-run，且不返回完整 `renderedDraft`。需要检查完整合并草案时加：

```powershell
--include-rendered-draft
```

确认要写入本地规则文件时才加：

```powershell
--apply
```

`--apply` 只写本地 `qferry.rules.json`，不会移动、删除、标记真实邮件。

## 审计留痕

带 `runId` 的扫描/preview 命令会写入：

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
```

未传 `--run-id` 时，CLI 会自动生成一个 run id。可以用 `QFERRY_CLI_TRACE_ROOT` 指定 trace 根目录；默认写到当前仓库工作目录。

CLI 输出为 JSON，适合保存为 e2e 证据或喂给后续脚本。

## QQ Mail 配置

CLI 使用和插件相同的运行时配置：

```text
QFERRY_PROVIDER=qqmail
QQMAIL_EMAIL=your@qq.com
QQMAIL_KEY=your-qq-mail-authorization-code
QQMAIL_METADATA_SAMPLE_LIMIT=10
QFERRY_RULES_FILE=C:\Users\Disas\AppData\Local\qferry\qferry.rules.json
```

`QQMAIL_KEY` 只能放在环境变量或本地 env 文件里，不要写进命令参数、JSON 输入、文档、trace 或仓库文件。

## 开发检查

```powershell
rtk pnpm --filter @qferry/cli test
rtk pnpm --filter @qferry/cli run typecheck
```

涉及 core 或插件包行为变化时，仍需跑完整门控并同步插件缓存：

```powershell
rtk pnpm run check
rtk pnpm run qferry:e2e:plugin-qq-readonly
rtk pnpm run dev:sync-plugin-cache:all -- --apply
```
