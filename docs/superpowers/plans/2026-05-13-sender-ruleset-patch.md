# Sender Ruleset Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the sender governance loop by turning selected sender/domain candidates into auditable local ruleset patch drafts while staying preview-first.

**Architecture:** Keep `plan_sender_governance` as the single flow surface. It performs bounded metadata scanning, returns domain candidates, generates `rulesetPatch.rulesToAdd` for selected sender/domain filters, reports duplicates against inline rules or `rulesFile`, and keeps operation plans in `preview` state.

**Tech Stack:** TypeScript, MCP SDK, Vitest, pnpm, QFerry plugin fixture/QQ readonly e2e scripts.

---

### Task 1: Core Ruleset Patch Draft

**Files:**
- Modify: `packages/core/src/tools/mail-tools.ts`
- Test: `packages/core/test/mail-tools.test.ts`

- [ ] Add failing tests for `rulesetPatch.rulesToAdd`, `groupToEnsure`, and duplicate skip behavior.
- [ ] Run `pnpm exec vitest packages/core/test/mail-tools.test.ts` and verify failure.
- [ ] Add `rules`/`rulesFile` inputs to `planSenderGovernance`, build rule drafts from selected sender/domain filters, and dedupe against existing rule matches.
- [ ] Re-run the focused test and verify pass.

### Task 2: MCP And Trace Evidence

**Files:**
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Modify: `apps/chatgpt-app/test/mcp-server.test.ts`
- Modify: `scripts/run-qferry-plugin-fixture-e2e.mjs`
- Modify: `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`
- Modify: `plugins/qferry/skills/qferry/SKILL.md`
- Modify: `docs/CODEX_PLUGIN_ACCEPTANCE.md`

- [ ] Extend MCP schema to accept inline rules and `rulesFile`.
- [ ] Assert MCP output includes `rulesetPatch`.
- [ ] Record `senderGovernanceRulesToAdd` and `senderGovernanceSkippedDuplicates` in fixture and QQ readonly e2e summaries/traces.
- [ ] Update docs and skill text to make clear this is a local ruleset draft, not a QQ server-side blocklist mutation.
