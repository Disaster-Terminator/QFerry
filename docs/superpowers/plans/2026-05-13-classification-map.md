# Classification Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Gmail-like read-only classification map that groups QQ Mail by action/value before any cleanup plan.

**Architecture:** Reuse QFerry metadata scanning and bulk governance classification, but return bucket summaries and recommended next actions without generating a mutation plan. Keep cleanup tools separate so classification is the default first step and mutations remain explicit follow-up actions.

**Tech Stack:** TypeScript, QFerry core mail tools, MCP server tool registration, Vitest, pnpm.

---

### Task 1: Core Classification Map

**Files:**
- Modify: `packages/core/src/tools/mail-tools.ts`
- Test: `packages/core/test/mail-tools.test.ts`

- [x] Add a failing Vitest case that calls `tools.classificationMap({ folder: "INBOX", pageSize: 2, maxPages: 4, order: "oldest" })` on fixture messages containing security/account, receipt, developer, marketing, newsletter, and review items.
- [x] Assert the result has `mutationsAttempted: 0`, no `plan`, grouped bucket counts, sample refs, and `recommendedAction` values like `keep`, `archive_or_label`, `review`, and `move_to_junk_after_review`.
- [x] Implement `ClassificationMapInput`, `ClassificationMap`, and `classificationMap` in `createMailTools` using existing metadata scan/window scan helpers and `classifyBulkGovernanceMessage`.
- [x] Run `pnpm exec vitest packages/core/test/mail-tools.test.ts --run`.

### Task 2: MCP Exposure

**Files:**
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Test: `apps/chatgpt-app/test/mcp-server.test.ts`

- [x] Add a failing MCP server test asserting `classification_map` appears in the tools list with `readOnlyHint: true`.
- [x] Register `classification_map` as read-only, using bounded `pageSize`, `maxPages`, `scanOffset`, and `order`.
- [x] Run `pnpm exec vitest apps/chatgpt-app/test/mcp-server.test.ts --run`.

### Task 3: Plugin Guidance And Verification

**Files:**
- Modify: `plugins/qferry/skills/qferry/SKILL.md`
- Generated: `plugins/qferry/dist/mcp.cjs`

- [x] Update the QFerry skill so mailbox governance starts with `classification_map`, then optional sender governance or cleanup preview.
- [x] Run `pnpm run check`.
- [x] Run `pnpm run qferry:e2e:plugin-fixture`.
- [x] Run `pnpm run qferry:e2e:plugin-qq-readonly`.
- [x] Run `pnpm run dev:sync-plugin-cache:all -- --apply`.
- [x] Commit and push the completed change.
