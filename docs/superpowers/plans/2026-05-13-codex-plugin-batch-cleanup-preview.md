# Codex Plugin Batch Cleanup Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex plugin tool that scans bounded QQ mailbox pages with QFerry rules, summarizes candidate groups, and creates a preview-only batch cleanup plan before any real mutation.

**Architecture:** Keep the implementation in `packages/core` and expose it through the existing MCP server wrapper. The tool scans metadata page-by-page using provider offsets, applies deterministic rules, caps selected refs, returns grouped counts/samples, and creates an `OperationPlan` with `status: "preview"` and `mutationsAttempted: 0`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `vitest`, existing QFerry trace/e2e scripts, `pnpm`.

---

## Current Test Surface

The Codex plugin currently exposes these testable tools:

- `get_status`
- `list_mailboxes`
- `get_mailbox_summary`
- `get_capability_snapshot`
- `search`
- `fetch`
- `classify_messages`
- `triage_inbox`
- `group_spam_candidates`
- `plan_cleanup`
- `execute_cleanup`

Existing e2e coverage:

- `pnpm run qferry:e2e:plugin-fixture`
- `pnpm run qferry:e2e:plugin-qq-readonly`
- `pnpm run qferry:e2e:plugin-qq-move-spam`

The main Gmail-alignment gap for the Codex plugin is cross-page organization: Gmail-like cleanup often starts from a search/rule result set, not one metadata page. QFerry has pagination primitives, selected-ref plans, and confirmed execution, but does not yet expose a single preview tool that scans multiple bounded pages and returns a batch operation plan with audit-friendly counts.

## Files

- Modify: `packages/core/src/tools/mail-tools.ts`
- Modify: `packages/core/test/mail-tools.test.ts`
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Modify: `apps/chatgpt-app/test/mcp-server.test.ts`
- Modify: `scripts/run-qferry-plugin-fixture-e2e.mjs`
- Modify: `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`
- Modify: `plugins/qferry/skills/qferry/SKILL.md`
- Modify: `docs/CODEX_PLUGIN_ACCEPTANCE.md`
- Modify after build: `plugins/qferry/dist/mcp.cjs`

## Task 1: Core Batch Preview Tool

- [ ] Add `PreviewCleanupBatchInput` and `CleanupBatchPreview` types in `packages/core/src/tools/mail-tools.ts`.
- [ ] Write a failing unit test named `creates preview batch cleanup plans across pages`.
- [ ] Implement `previewCleanupBatch(input)` in `createMailTools`.
- [ ] The implementation must scan pages with `{ folder, limit: pageSize, order, offset }`, stop when `maxPages` is reached or an empty page is returned, classify every sampled message, group counts by classification group, select only `selectedGroupIds`, cap selected refs at `maxMessageRefs`, and create a preview `OperationPlan`.
- [ ] The result must include `mutationsAttempted: 0`, `scannedMessages`, `pagesScanned`, `scanOffset`, `pageSize`, `maxPages`, `selectedMessageRefs`, `groupCounts`, `sampledMessages`, optional `ruleset`, and `plan`.
- [ ] Run `pnpm --filter @qferry/core test -- mail-tools.test.ts`.

## Task 2: MCP Exposure

- [ ] Register a new MCP tool `preview_cleanup_batch` in `apps/chatgpt-app/src/mcp-server.ts`.
- [ ] Mark it `readOnlyHint: false` because it creates an operation plan, but keep `destructiveHint: false` and `idempotentHint: true`.
- [ ] Add MCP server tests that verify the tool is listed and returns a preview plan on fixture data.
- [ ] Run `pnpm --filter @qferry/chatgpt-app test`.

## Task 3: E2E Audit Coverage

- [ ] Add `preview_cleanup_batch` to `scripts/run-qferry-plugin-fixture-e2e.mjs`.
- [ ] Add read-only `preview_cleanup_batch` to `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`.
- [ ] The QQ read-only e2e must keep `mutationsAttempted: 0` and record preview plan status, selected ref count, scanned messages, and pages scanned in the summary.
- [ ] Do not add real sender/domain test targets to tracked files.
- [ ] Run `pnpm run qferry:e2e:plugin-fixture`.

## Task 4: Docs And Plugin Skill

- [ ] Update `plugins/qferry/skills/qferry/SKILL.md` so the default workflow uses `preview_cleanup_batch` before `execute_cleanup` when a user wants cross-page organization.
- [ ] Update `docs/CODEX_PLUGIN_ACCEPTANCE.md` with the new tool and expected trace evidence.
- [ ] Update `docs/RETINUE_E2E_NOTES.md` with Retinue job IDs and findings from this round.

## Task 5: Verification, Cache Sync, Commit

- [ ] Run `pnpm run check`.
- [ ] Run `pnpm run qferry:e2e:plugin-fixture`.
- [ ] Run `pnpm run qferry:e2e:plugin-qq-readonly`.
- [ ] Run a minimal real mutation e2e only if a clearly low-value candidate is found by the new preview path; otherwise record the no-candidate result and do not force mutation.
- [ ] Run `pnpm run dev:sync-plugin-cache:all -- --apply`.
- [ ] Verify no real adult-domain test target is tracked in Git.
- [ ] Commit and push.
