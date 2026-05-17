# QQ Read-only Plugin Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the QFerry Codex plugin usable against the real QQ mailbox in read-only mode, with explicit runtime status, inbox triage output, and traceable e2e evidence.

**Architecture:** Keep ChatGPT App frozen and continue using the existing MCP server as the plugin runtime. Add a small local runtime configuration layer for provider selection and safety limits, extend the core mail tools with a read-only triage report, and prove the installed-plugin path with fixture and QQ read-only e2e artifacts. Real mailbox mutations remain impossible in this milestone.

**Tech Stack:** TypeScript, pnpm, MCP SDK, ImapFlow, Vitest, JSONL trace artifacts, Codex plugin packaging.

---

## File Structure

- Create `packages/core/src/runtime-config.ts`: parse a QFerry runtime config object from environment and optional local JSON file without ever storing or printing `QQMAIL_KEY`.
- Create `packages/core/test/runtime-config.test.ts`: tests for config precedence, masking, default fixture mode, and QQ read-only safety limits.
- Modify `packages/core/src/tools/mail-tools.ts`: add `getStatus()` and `triageInbox()` to the shared tool surface.
- Modify `packages/core/test/mail-tools.test.ts`: cover status and triage behavior with fixture metadata.
- Modify `apps/chatgpt-app/src/mcp-server.ts`: use `runtime-config.ts`, register `get_status` and `triage_inbox`, and keep `createProviderFromEnv()` compatible with plugin-local runtime.
- Modify `apps/chatgpt-app/test/mcp-server.test.ts`: verify the new tools are exposed as read-only and return structured content.
- Modify `scripts/run-qferry-plugin-fixture-e2e.mjs`: include `get_status` and `triage_inbox` in trace/summary.
- Modify `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`: include `get_status` and `triage_inbox` in real QQ read-only trace/summary, preserving `mutationsAttempted: 0` on success and failure.
- Modify `plugins/qferry/skills/qferry/SKILL.md`: tell agents to call status first, then bounded triage, then preview plan.
- Modify `README.md` and `docs/CODEX_PLUGIN_ACCEPTANCE.md`: document local QQ read-only config and acceptance commands.

## Runtime Config Shape

Config source order:

1. Environment variables remain the highest priority for secrets and CI/e2e.
2. Optional local JSON at `QFERRY_CONFIG_FILE`.
3. Optional default local JSON at `%LOCALAPPDATA%\qferry\config.json` on Windows or `$XDG_CONFIG_HOME/qferry/config.json` on Unix-like systems.
4. Safe defaults: `provider=fixture`, `mutationAllowed=false`, `metadataSampleLimit=1`.

Local JSON example:

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

`QQMAIL_KEY` remains environment-only for this milestone. The config layer must report missing key as a status warning, not write the key to disk.

`get_status` is intentionally separate from `get_capability_snapshot`:

- `get_capability_snapshot` reports what the active provider can do.
- `get_status` reports how QFerry is configured right now: provider, account alias, config source, metadata sample limit, mutation gate, and warnings such as missing QQ auth.

`triage_inbox` is intentionally separate from `classify_messages`:

- `classify_messages` returns per-message rule matches.
- `triage_inbox` returns a product-level inbox review summary: sampled count, group counts, representative classifications, ruleset metadata, recommended next action, and `mutationsAttempted: 0`.

## Task 1: Runtime Config And Status

**Files:**
- Create: `packages/core/src/runtime-config.ts`
- Create: `packages/core/test/runtime-config.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Modify: `apps/chatgpt-app/test/mcp-server.test.ts`

- [ ] Write failing tests for runtime config defaults.

Expected assertions:

```ts
expect(loadQFerryRuntimeConfig({ env: {}, readFile: async () => undefined })).toMatchObject({
  provider: "fixture",
  mutationAllowed: false,
  metadataSampleLimit: 1,
  statusWarnings: [],
});
```

- [ ] Write failing tests for QQ config precedence and masking.

Expected assertions:

```ts
const config = await loadQFerryRuntimeConfig({
  env: {
    QFERRY_PROVIDER: "qqmail",
    QQMAIL_EMAIL: "25abc@qq.com",
    QQMAIL_KEY: "secret",
    QQMAIL_METADATA_SAMPLE_LIMIT: "3"
  },
  readFile: async () => undefined,
});
expect(config.provider).toBe("qqmail");
expect(config.accountAlias).toBe("25***@qq.com");
expect(config.qqmail?.authCodePresent).toBe(true);
expect(JSON.stringify(config)).not.toContain("secret");
```

- [ ] Implement `loadQFerryRuntimeConfig()` with safe defaults and max sample limit clamped to `1..10`.

- [ ] Add explicit acceptance assertion that `JSON.stringify(runtimeConfig)` never contains `QQMAIL_KEY`, auth code values, or a raw email password.

- [ ] Export runtime config types from `packages/core/src/index.ts`.

- [ ] Replace ad hoc provider creation in `apps/chatgpt-app/src/mcp-server.ts` with runtime config.

- [ ] Add MCP tool `get_status` returning provider, accountAlias, configSource, mutationAllowed, metadataSampleLimit, and warnings.

- [ ] Run `rtk pnpm --filter @qferry/core test -- runtime-config.test.ts` and `rtk pnpm --filter qferry-chatgpt-app test -- mcp-server.test.ts`.

- [ ] Commit: `feat: add qferry runtime status`

## Task 2: Read-only Triage Report

**Files:**
- Modify: `packages/core/src/tools/mail-tools.ts`
- Modify: `packages/core/test/mail-tools.test.ts`
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Modify: `apps/chatgpt-app/test/mcp-server.test.ts`
- Modify: `plugins/qferry/skills/qferry/SKILL.md`

- [ ] Write failing tests for `triageInbox()`.

Expected output shape:

```ts
expect(result.triage).toMatchObject({
  provider: "fixture",
  folder: "INBOX",
  sampledMessages: 2,
  groupCounts: { review: 1, newsletter: 1 },
  recommendedNextAction: "review_preview_plan",
  mutationsAttempted: 0,
});
expect(result.classifications).toHaveLength(2);
```

- [ ] Implement `triageInbox(input)` by scanning bounded metadata once, classifying with inline rules or `rulesFile`, aggregating group counts, and returning a deterministic preview-only report.

- [ ] Register MCP tool `triage_inbox` with read-only annotations.

- [ ] Update the QFerry skill to recommend this order: `get_status` -> `list_mailboxes` -> `triage_inbox` -> `plan_cleanup`.

- [ ] Update the QFerry skill to explain that `triage_inbox` is the default Gmail-like inbox review tool, while `classify_messages` is lower-level debugging or focused classification.

- [ ] Run `rtk pnpm --filter @qferry/core test -- mail-tools.test.ts` and `rtk pnpm --filter qferry-chatgpt-app test -- mcp-server.test.ts`.

- [ ] Commit: `feat: add read-only inbox triage`

## Task 3: Plugin E2E Evidence

**Files:**
- Modify: `scripts/run-qferry-plugin-fixture-e2e.mjs`
- Modify: `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`
- Modify: `README.md`
- Modify: `docs/CODEX_PLUGIN_ACCEPTANCE.md`

- [ ] Add `get_status` and `triage_inbox` calls to fixture e2e.

Trace must include:

```json
{"event":"plugin_tool_called","toolName":"get_status"}
{"event":"plugin_tool_called","toolName":"triage_inbox","sampledMessages":2}
```

- [ ] Add `get_status` and `triage_inbox` calls to QQ read-only e2e.

Trace must include:

```json
{"event":"plugin_tool_called","toolName":"get_status","provider":"qqmail"}
{"event":"plugin_tool_called","toolName":"triage_inbox","mutationAllowed":false}
```

- [ ] Keep QQ failure handling: every failure writes `plugin_qq_readonly_e2e_finished` with `ok:false`, `mutationsAttempted:0`, and an error object.

- [ ] Update summaries to include `statusProvider`, `statusWarnings`, `triageGroupCounts`, `sampledMessages`, `rulesetVersion`, and `mutationsAttempted`.

- [ ] Add one fixture e2e variant that sets `QFERRY_CONFIG_FILE` to a temporary local JSON config and records `configSource` in the trace. This proves file config precedence without touching real QQ secrets.

- [ ] Update docs with the local config file path, env-only secret boundary, and exact acceptance commands:

```powershell
rtk pnpm run check
rtk pnpm qferry:e2e:plugin-fixture
rtk pnpm qferry:e2e:plugin-qq-readonly
```

- [ ] Run the three acceptance commands and inspect the latest trace/summary files.

- [ ] Commit: `test: cover qq plugin triage workflow`

## Task 4: Packaging Verification And Push

**Files:**
- Modify only if needed: `scripts/verify-qferry-plugin.mjs`
- Modify only if needed: `plugins/qferry/README.md`

- [ ] Ensure `rtk pnpm run verify:qferry-plugin` passes after `sync:qferry-plugin`.

- [ ] Confirm plugin dist is regenerated and does not reference source checkout paths.

- [ ] Run `rtk git status --short`; the only changes should be intentional.

- [ ] Push `main`.

## Acceptance Criteria

- `get_status` is visible from the Codex plugin and returns fixture by default.
- QQ read-only e2e can force `provider=qqmail` without storing `QQMAIL_KEY` in repo, config, summary, or trace.
- `triage_inbox` works against fixture and real QQ bounded metadata.
- `triage_inbox` returns the same output shape for fixture and QQ: `triage`, `classifications`, optional `ruleset`, and `mutationsAttempted`.
- Latest QQ read-only summary contains `provider: qqmail`, `sampledMessages`, `triageGroupCounts`, `previewPlanStatus: preview`, and `mutationsAttempted: 0`.
- Failed QQ read-only runs produce `ok:false` summary and JSONL trace.
- `JSON.stringify(runtimeConfig)` does not contain `QQMAIL_KEY` or any auth secret value.
- At least one e2e trace proves `QFERRY_CONFIG_FILE` config loading and records `configSource`.
- `rtk pnpm run check` passes.
- Work is split into small commits rather than one large diff.

## Self-review

- Scope stays on Codex plugin and shared core only; ChatGPT App remains frozen except for the shared MCP runtime file that the plugin already bundles.
- No step adds mailbox mutation.
- No step stores `QQMAIL_KEY`.
- Real QQ testing is included and bounded; fixture-only progress is not accepted.
