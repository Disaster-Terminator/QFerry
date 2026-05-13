# Governance Control Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the practical control layer needed before large-scale real QQ mailbox governance: local ruleset patch dry-run/apply and per-batch ledger evidence.

**Architecture:** Keep mailbox operations preview-first. `apply_ruleset_patch` only mutates the local rules file when `apply: true`; it never touches QQ Mail. Governance e2e writes a JSONL ledger per run so future batch cleanup can resume and audit scan offsets, candidates, selected refs, and rule changes.

**Tech Stack:** TypeScript, MCP SDK, Vitest, pnpm, JSONL artifacts, QFerry plugin e2e scripts.

---

### Task 1: Local Ruleset Patch Apply

**Files:**
- Modify: `packages/core/src/ruleset-patch.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ruleset-patch.test.ts`

- [x] Add failing test for dry-run and apply against a temporary rules file.
- [x] Run focused vitest and verify `applyRulesetPatchDraft is not a function`.
- [x] Implement `applyRulesetPatchDraft` with `apply: false` dry-run and `apply: true` local file write.
- [x] Re-run focused vitest and verify pass.

### Task 2: Governance Ledger

**Files:**
- Create: `packages/core/src/governance-ledger.ts`
- Create: `packages/core/test/governance-ledger.test.ts`
- Modify: `packages/core/src/index.ts`

- [x] Add failing ledger test for JSONL batch lifecycle records.
- [x] Implement `GovernanceRunLedger.record`.
- [x] Add structured `resumeToken`, completed ref count, and error count fields for future resumable governance.
- [x] Re-run focused vitest and verify pass.

### Task 3: Plugin Tool And E2E Evidence

**Files:**
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Modify: `apps/chatgpt-app/test/mcp-server.test.ts`
- Modify: `scripts/run-qferry-plugin-fixture-e2e.mjs`
- Modify: `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`
- Modify: `plugins/qferry/skills/qferry/SKILL.md`
- Modify: `docs/CODEX_PLUGIN_ACCEPTANCE.md`

- [x] Add failing MCP test for `apply_ruleset_patch` dry-run.
- [x] Register `apply_ruleset_patch` as a local-rules-only tool.
- [x] Add fixture/QQ readonly e2e dry-run calls and governance ledger files.
- [x] Record dry-run result and ledger path in summaries.
- [x] Run `pnpm run check`, plugin fixture e2e, QQ readonly e2e, cache sync, sensitive scans, commit, and push.
