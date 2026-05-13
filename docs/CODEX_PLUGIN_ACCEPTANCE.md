# QFerry Codex 插件安装与验收

本文档面向维护者和开发者。普通用户优先阅读根目录 `README.md` 的快速开始。

## 用户安装路径

QFerry 当前通过 Codex 插件市场安装：

```powershell
codex plugin marketplace add Disaster-Terminator/QFerry
```

然后打开 Codex，运行 `/plugins`，按键盘右方向键切到 `[QFerry Local]` 插件市场，按 Enter 打开 `QFerry` 详情页，选择 `Install plugin`。

Codex CLI 的 `codex plugin marketplace add/upgrade/remove` 管理的是插件市场，不是直接安装插件。插件安装在 Codex TUI 的 `/plugins` 里完成。

## 插件目录

仓库内插件目录是：

```text
G:\repository\QFerry\plugins\qferry
```

关键文件：

```text
plugins/qferry/.codex-plugin/plugin.json
plugins/qferry/.mcp.json
plugins/qferry/mcp-bootstrap.mjs
plugins/qferry/dist/mcp.cjs
plugins/qferry/skills/qferry/SKILL.md
```

插件 MCP 配置必须使用 Codex plugin wrapper：

```json
{
  "mcpServers": {
    "qferry": {
      "command": "node",
      "args": ["./mcp-bootstrap.mjs"],
      "cwd": ".",
      "startup_timeout_sec": 30,
      "env": {
        "QFERRY_PROVIDER": "fixture"
      }
    }
  }
}
```

`cwd: "."` 用来保证 Codex 从安装后的插件缓存目录启动 plugin-local bootstrap，而不是从当前对话工作目录启动。`mcp-bootstrap.mjs` 再加载同目录下的 `dist/mcp.cjs`，并把运行 cwd 切到 `QFERRY_STATE_DIR` 或用户状态目录，避免 Windows 下 MCP 进程占住插件缓存目录，导致插件详情、升级或卸载失败。不要把 `.mcp.json` 指向源码目录、`tsx` 或开发 checkout。

## QQ 邮箱配置

fixture provider 是默认路径，不需要真实邮箱授权。

真实 QQ read-only 验收需要在本机环境提供：

```text
QQMAIL_EMAIL=your@qq.com
QQMAIL_KEY=your-qq-mail-authorization-code
QQMAIL_METADATA_SAMPLE_LIMIT=1
```

非密钥配置也可以放在本机 JSON 文件，并通过 `QFERRY_CONFIG_FILE` 指向：

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

`QQMAIL_KEY` 是 QQ 邮箱 IMAP/SMTP 授权码，不是 QQ 登录密码。它只通过环境变量提供，不写入本机 JSON、仓库、trace 或 summary。真实账号验收只允许小批量 metadata 读取。

## 规则文件

QFerry 支持通过 `rulesFile` 加载持久化分类规则。仓库示例：

```text
examples/qferry.rules.json
```

规则文件包含：

- `version`：规则版本，会写入 e2e summary。
- `defaultGroupId`：没有命中规则时使用的 group。
- `groups`：用户定义的分类组。
- `rules`：按顺序匹配的 metadata 规则。
- `rules[].match.fromDomainIncludes`：按发件人域名匹配，适合 sender/domain 治理规则。
- `rules[].priority`：可选优先级分桶配置，包含 `bucketId`、`reason`、`confidence`、`weight`、`nextAction`。`weight` 为 0-100，用于同一 bucket 内候选排序。

工具仍兼容直接传入内联 `rules`。真实 QQ 路径使用规则文件时仍然只生成 preview plan，不执行邮箱写操作。

## 批量整理预览

`preview_cleanup_batch` 是 Codex 插件侧的规则化批量整理入口。它跨页扫描 bounded metadata，应用 `rules` 或 `rulesFile`，按 `selectedGroupIds` 选出候选邮件，并生成 `status: "preview"` 的 operation plan。

验收时必须关注这些字段：

- `preview.pagesScanned`
- `preview.scannedMessages`
- `preview.groupCounts`
- `preview.selectedMessageRefs`
- `plan.status`
- `plan.messageRefs.length`
- `mutationsAttempted`

真实 QQ read-only e2e 调用该工具时仍必须保持 `mutationsAttempted: 0`。只有用户明确授权某个 plan 后，才允许调用 `confirm_cleanup_plan({ operationPlanId })`；真实执行必须再调用 `execute_cleanup({ operationPlanId })`，不能由客户端手写或修改 `status: "confirmed"` 的 plan JSON。

## 结构化搜索与优先级分桶

`search` 支持 metadata-only 结构化过滤：

- `fromIncludes`
- `fromDomainIncludes`
- `subjectIncludes`
- `snippetIncludes`
- `hasFlag`
- `dateAfter`
- `dateBefore`
- `order`
- `offset`

这些过滤在 bounded metadata scan 之后执行，语义是 AND，不读取正文、不下载附件。

`triage_inbox` 在原有 `groupCounts` 外返回行动优先级：

- `urgent`
- `needs_review`
- `waiting`
- `fyi`
- `bulk`

验收时记录 `priorityCounts`，并把它当作候选排序信号，不把 metadata 启发式当成绝对判断。

当命中的规则带有 `priority` 配置时，`triage_inbox` 优先采用规则配置的分桶、原因、置信度、权重和下一步，并按 bucket 内权重降序输出候选；否则回退到内置 metadata 启发式。

## 黑名单边界

QQ 邮箱产品层面有“设置 / 反垃圾 / 黑名单或黑白名单”能力，但当前 QFerry 没有验证到可通过 IMAP/SMTP/MCP 直接写入 QQ 服务器侧黑名单的公开接口。

`plan_sender_governance` 是当前替代路径：它只扫描 bounded metadata，聚合发件人域名候选，生成本地规则建议，并在选定 sender/domain 后生成 `status: "preview"` 的 move plan。工具输出必须保留 `serverBlocklistCapability.supported: false`，直到上游 provider 明确暴露可审计的服务器侧黑名单接口。

当用户选定 sender/domain 时，验收还要记录 `rulesetPatch.rulesToAdd.length`、`rulesetPatch.skippedDuplicateRules.length`、`rulesetPatch.renderedDraft.rules.length`、`rulesetPatch.changelog` 行数和 `rulesetPatch.groupToEnsure`。这只是规则草案，不会直接写入真实邮箱或服务器侧黑名单。

`apply_ruleset_patch` 只允许作用于本地 QFerry rules 文件。验收默认使用 `apply: false` dry-run，并记录 `rulesetPatchDryRunApplied`、`rulesetPatchDryRunAddedRules` 和 `governanceLedger`。只有用户明确要求持久化规则时，才允许 `apply: true`，且这仍然不等于 QQ 邮箱服务器侧黑名单或邮件 mutation。

QFerry 当前支持的是规则层 blocklist：

- 在规则文件或 e2e 脚本中按发件人、域名、主题等 metadata 匹配。
- 生成可审计 preview plan。
- 在用户授权的真实 mutation e2e 中，经 `confirm_cleanup_plan` 确认后将匹配邮件移动到 `Junk`。

这能清理当前邮箱和持续识别同源垃圾邮件，但还不等于 QQ 邮箱服务器侧拒收。服务器侧拉黑需要后续 QQ Web 自动化或已验证接口支持。

### QQ Web 自动化验证方案

后续若要实现真正服务器侧拉黑，按单独里程碑处理，不混入 IMAP 清理流程：

1. 使用独立浏览器 profile 登录 `mail.qq.com`，进入 QQ 邮箱设置页。
2. 定位 `反垃圾` / `黑名单` / `黑白名单` 管理入口，验证是否能添加完整邮箱地址或域名。
3. 只用已确认垃圾来源，例如本地测试记录里的明确垃圾发件人或域名，避免误伤验证码、安全通知、支付收据。
4. 记录浏览器操作 trace、页面截图、添加前后黑名单条目；不得记录 QQ 登录态、Cookie、授权码。
5. 若页面请求暴露稳定的后端接口，再评估是否封装为 QFerry 工具；否则保持为浏览器自动化/人工操作 runbook。
6. QFerry 工具命名必须区分 `move_to_junk` 和 `server_block_sender`，避免把 IMAP 移动误报成服务器侧拒收。

## 当前边界

允许：

- 安装本地 Codex 插件。
- 启动 plugin-local MCP runtime：`plugins/qferry/mcp-bootstrap.mjs` -> `plugins/qferry/dist/mcp.cjs`。
- 使用 fixture provider 验证工具发现和调用。
- 使用 QQ read-only provider 验证真实 QQ 邮箱的 capability、文件夹列表、小批量 metadata。
- 使用结构化 `search` 验证 metadata 过滤，不读取正文。
- 使用 `triage_inbox` 验证 priority buckets。
- 使用 `preview_cleanup_batch` 验证跨页规则预览和 preview operation plan。

默认禁止：

- 未经明确授权和服务端确认 plan 的真实 QQ 邮件移动。
- 标记已读/未读。
- 创建/删除 QQ 文件夹。
- 删除邮件。
- 发送邮件。
- 下载附件。
- 全量扫描邮箱。

真实 QQ read-only 验收必须保持：

```text
mutationsAttempted: 0
QQMAIL_METADATA_SAMPLE_LIMIT=1
```

真实 mutation 验收必须是单独、显式授权的小批量测试，并在 trace/summary 中记录 preview plan、`confirm_cleanup_plan`、`execute_cleanup`、目标文件夹和 `mutationsAttempted`。

状态字段验收时要区分：

- `mutationAllowed`：兼容字段，表示当前 provider 路径具备执行 mutation 的产品能力。
- `authConfigured`：当前运行环境是否已配置真实 provider 所需凭据。
- `providerReady`：当前 provider 是否具备执行工具调用的运行条件。
- `mutationCapable`：当前 provider 是否具备可实际调用的 mutation capability。
- `mutationOperationallyReady`：当前账号/凭据是否已达到真实 mutation 的运行条件。
- `mutationRequiresConfirmation`：真实 mutation 是否必须通过 preview plan、`confirm_cleanup_plan` 和 `execute_cleanup`。

QQ provider 的 `fetch` 必须按 `folder + uid + uidValidity` 精确读取选中邮件 metadata，不能依赖最新 bounded scan 回查 UID。

Gmail-like 大批量治理验收优先走 `bulk_governance_preview`。该工具可以扫描较大 metadata 窗口并按 sender/domain/content 分类，但仍是 dry-run preview；真实 QQ mutation 只允许在用户明确授权后，对高置信广告/营销等小范围子集执行。

## 部署后验收

用户把插件部署到本机 Codex 后，下一轮测试目标是：

1. Codex 能发现 QFerry 插件。
2. Codex 能加载 `qferry` skill。
3. QFerry MCP server 能从 plugin-local `mcp-bootstrap.mjs` 启动，并加载 `dist/mcp.cjs`。
4. fixture 工具调用成功。
5. QQ read-only 工具调用成功。
6. 规则文件版本、批量预览统计和 preview plan 状态写入本地 trace artifacts。

建议让 Codex 执行：

```text
Use QFerry to list mail folders with the fixture provider. Then explain which tools are available.
```

配置 QQ 邮箱后再执行：

```text
Use QFerry to inspect QQ Mail capability and list folders safely. Do not mutate mailbox data.
```

## 测试留痕

预期验收 artifacts：

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
```

这些文件用于验收和回溯，不提交到仓库。

## 开发检查

仓库公开或发布前应确认：

```powershell
rtk pnpm run check
rtk pnpm qferry:e2e:plugin-fixture
rtk pnpm qferry:e2e:plugin-qq-readonly
rtk uv run python -m unittest tests.test_probe_qqmail
```

敏感文件不入库：

```text
.env
logs/
artifacts/
node_modules/
```

## License

QFerry 使用 Apache License 2.0。

```text
Copyright 2026 RayStorm
SPDX-License-Identifier: Apache-2.0
```
