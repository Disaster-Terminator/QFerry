# Sender Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex-plugin-first sender/domain governance preview flow for QFerry, close to Gmail's sender-driven organization without pretending QQ IMAP exposes server-side blocklists.

**Architecture:** Extend classification rules with `fromDomainIncludes`, then add a preview-only `plan_sender_governance` mail tool and MCP tool. The tool scans bounded metadata, aggregates sender/domain candidates, emits suggested local rules with priority weights, reports provider blocklist capability as unavailable when only IMAP move is exposed, and creates an operation plan only for explicitly selected sender/domain filters.

**Tech Stack:** TypeScript, MCP SDK, Vitest, pnpm, QFerry fixture and QQ readonly plugin e2e scripts.

---

### Task 1: Rule Domain Matching

**Files:**
- Modify: `packages/core/src/classification.ts`
- Modify: `packages/core/src/ruleset.ts`
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Test: `packages/core/test/classification.test.ts`
- Test: `packages/core/test/ruleset.test.ts`

- [ ] Add failing tests showing `fromDomainIncludes` matches sender domains and ruleset parsing accepts it.
- [ ] Run `pnpm exec vitest packages/core/test/classification.test.ts packages/core/test/ruleset.test.ts` and verify failure.
- [ ] Add `fromDomainIncludes` to the rule match type, parser allowlist, explanation text, and MCP schema.
- [ ] Re-run the focused tests and verify pass.

### Task 2: Sender Governance Tool

**Files:**
- Modify: `packages/core/src/tools/mail-tools.ts`
- Test: `packages/core/test/mail-tools.test.ts`

- [ ] Add failing tests for bounded sender/domain aggregation, blocklist capability gap output, suggested rules, selected domain preview plan, and `mutationsAttempted: 0`.
- [ ] Run `pnpm exec vitest packages/core/test/mail-tools.test.ts` and verify failure.
- [ ] Implement `planSenderGovernance` using bounded `scanMailboxMetadata` pages, local aggregation, selected sender/domain matching, and `createOperationPlan`.
- [ ] Re-run the focused tests and verify pass.

### Task 3: MCP Surface And E2E Trace

**Files:**
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Modify: `apps/chatgpt-app/test/mcp-server.test.ts`
- Modify: `scripts/run-qferry-plugin-fixture-e2e.mjs`
- Modify: `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`
- Modify: `plugins/qferry/skills/qferry/SKILL.md`
- Modify: `docs/CODEX_PLUGIN_ACCEPTANCE.md`
- Test: `apps/chatgpt-app/test/mcp-server.test.ts`

- [ ] Add failing MCP test proving `plan_sender_governance` is listed and returns candidates, blocklist capability gap, and a preview plan.
- [ ] Register the MCP tool with read-only/preview annotations.
- [ ] Record sender governance candidate counts, selected refs, and blocklist support in fixture and QQ readonly e2e summaries/traces.
- [ ] Update plugin skill and acceptance docs.
- [ ] Run `pnpm run check`, plugin fixture e2e, QQ readonly e2e, cache sync, sensitive scans, commit, and push.
