# CLI Campaign Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI `campaign-workflow` command that chains discovery, local ruleset patch validation/application, and multi-folder ruleset campaign preview with traceable audit output and no QQ mailbox mutation.

**Architecture:** Keep business logic in `@qferry/core`; the CLI command is an orchestration adapter over existing core tools. Add focused CLI-side workflow input parsing, compact output shaping, and audit summary support. Do not add new classifier categories or hardcoded mailbox classes.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, tsx, `@qferry/core`.

---

### Task 1: Workflow Fixture Tests

**Files:**
- Modify: `apps/cli/test/cli.test.ts`

- [ ] **Step 1: Add a fixture test for dry-run workflow**

Add a test that writes temporary `qferry.rules.json` and `workflow.json`, then invokes:

```ts
const result = await invoke(["campaign-workflow", "--input", workflowFile], {
  cwd: dir,
  env: { QFERRY_CLI_TRACE_ROOT: traceRoot },
});
```

Expected assertions:

```ts
expect(result.code).toBe(0);
expect(result.json.command).toBe("campaign-workflow");
expect(result.json.result.workflow.discovery.campaign.mutationsAttempted).toBe(0);
expect(result.json.result.workflow.rulesetPatch.applied).toBe(false);
expect(result.json.result.workflow.preview.campaign.mutationsAttempted).toBe(0);
expect(result.json.result.workflow.mutationsAttempted).toBe(0);
```

- [ ] **Step 2: Add a fixture test for local patch apply**

Use a temporary rules file named exactly `qferry.rules.json`. Invoke the workflow with `applyRulesetPatch: true`, then read the rules file and assert its rule count increased. Also assert the command output still reports `workflow.mutationsAttempted: 0`.

- [ ] **Step 3: Add a fixture test for audit evidence**

Read:

```ts
join(traceRoot, "logs", "runs", "<runId>.jsonl")
join(traceRoot, "artifacts", "e2e", "<runId>", "summary.md")
```

Assert the trace contains `"command":"campaign-workflow"` and the summary contains `- mutationsAttempted: 0`, `- rulesToAdd:`, and `- campaignReport:`.

- [ ] **Step 4: Add a negative test for preview without rules file**

Use `preview.enabled: true` and omit `rulesFile`. Expected result:

```ts
expect(result.code).toBe(1);
expect(result.stderr).toContain("campaign-workflow preview requires rulesFile");
```

- [ ] **Step 5: Run focused failing tests**

Run:

```powershell
rtk pnpm --filter @qferry/cli test
```

Expected before implementation: tests fail because `campaign-workflow` is unknown.

### Task 2: CLI Workflow Orchestrator

**Files:**
- Modify: `apps/cli/src/cli.ts`

- [ ] **Step 1: Add workflow input types**

Add CLI-local interfaces near the existing `CliResult` type:

```ts
interface CampaignWorkflowInput extends MailboxGovernanceCampaignInput {
  runId?: string;
  applyRulesetPatch?: boolean;
  includeRenderedDraft?: boolean;
  preview?: {
    enabled?: boolean;
    action?: "move" | "mark_read" | "mark_unread" | "create_folder";
    maxMessageRefsPerGroup?: number;
    selectedGroupIds?: string[];
    maxUnplannedHintsPerFolder?: number;
  };
}
```

- [ ] **Step 2: Add the command branch**

Add a `campaign-workflow` case in `runCli` that loads JSON input, resolves `runId`, calls a new helper, stores compact `cliInput`, and writes normal CLI audit.

- [ ] **Step 3: Implement `runCampaignWorkflow`**

The helper should:

1. call `tools.planMailboxGovernanceCampaign`;
2. call `applyRulesetPatchDraft` with the discovered `rulesetPatch`;
3. call `tools.rulesetGovernanceCampaignPreview` only when `preview.enabled !== false`;
4. return `{ workflow: { discovery, rulesetPatch, preview, recommendedNextAction, mutationsAttempted: 0 } }`.

Use `includeRenderedDraft: false` by default.

- [ ] **Step 4: Validate ambiguous inputs**

If preview is enabled and no `rulesFile` is available in the workflow input, throw:

```ts
new Error("campaign-workflow preview requires rulesFile")
```

If `applyRulesetPatch: true` is passed without `rulesFile`, throw:

```ts
new Error("campaign-workflow applyRulesetPatch requires rulesFile")
```

- [ ] **Step 5: Add usage text**

Add:

```text
qferry campaign-workflow --input workflow.json
```

to `usage()`.

### Task 3: Audit Summary Support

**Files:**
- Modify: `apps/cli/src/audit.ts`

- [ ] **Step 1: Teach `summarizeCliResult` about workflow output**

Read `result.workflow` and summarize:

```ts
const workflow = record(result.workflow);
const discovery = record(workflow?.discovery);
const preview = record(workflow?.preview);
const workflowPatch = record(workflow?.rulesetPatch);
```

Use the workflow fields to populate provider, folders, scanned messages, planned messages, recommended action, ruleset patch counts, campaign report, folder reports, and mutations attempted.

- [ ] **Step 2: Keep existing command summaries working**

Do not remove the existing `planner`, `preview`, `campaign`, and `rulesetPatch` summary paths. The workflow path should be additive.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
rtk pnpm --filter @qferry/cli test
```

Expected: CLI tests pass.

### Task 4: Documentation

**Files:**
- Modify: `docs/CLI.md`
- Modify: `plugins/qferry/skills/qferry/SKILL.md`

- [ ] **Step 1: Document `campaign-workflow`**

Add a CLI section explaining that `campaign-workflow` is the preferred hot-iteration path for large dry-runs. Include a JSON example and explain that `applyRulesetPatch` only mutates the local rules file.

- [ ] **Step 2: Update plugin skill guidance**

Mention that for CLI hot iteration outside MCP reloads, use `qferry:cli -- campaign-workflow --input <json>` before spending agent tokens on manual mailbox governance.

- [ ] **Step 3: Keep mutation boundary explicit**

State that the workflow does not call `confirm_cleanup_plan` or `execute_cleanup`.

### Task 5: Verification, Review, Sync, Commit

**Files:**
- No direct source edits expected unless verification finds defects.

- [ ] **Step 1: Run full local check**

```powershell
rtk pnpm run check
```

Expected: pass.

- [ ] **Step 2: Run real QQ read-only e2e**

```powershell
rtk pnpm run qferry:e2e:plugin-qq-readonly
```

Expected: pass with `mutationsAttempted: 0`.

- [ ] **Step 3: Sync plugin cache**

```powershell
rtk pnpm run dev:sync-plugin-cache:all -- --apply
```

Expected: installed QFerry cache updated for detectable Codex hosts.

- [ ] **Step 4: Use Codex subagent review**

Ask one Codex subagent to review the staged diff for spec compliance and one to review code quality. Fix any concrete issues.

- [ ] **Step 5: Commit and push**

Commit source, tests, docs, generated dist if changed, and push to `origin main`.
