# QFerry CLI

QFerry CLI 是本仓库的本地热迭代入口，用来绕开 MCP 插件开发时必须重启 Codex 才能刷新工具 schema/runtime 的问题。

CLI 复用 `@qferry/core`，不复制分类器、不绕过安全策略。当前版本只覆盖只读、preview 和本地规则文件 patch：

- 可以读取运行状态、文件夹列表和文件夹摘要。
- 可以对 bounded metadata 窗口做 high-yield governance 规划。
- 可以用 JSON 输入生成 ruleset governance preview / campaign preview。
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
