# Gmail-like Bulk Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move QFerry from manual ref picking toward Gmail-like bulk mailbox governance: large-window dry-run classification, policy-generated cleanup plans, and small confirmed mutation tests only.

**Architecture:** Keep QQ Mail mutation preview-first. Add a bulk classification layer in `mail-tools` that scans bounded windows, groups messages by sender/domain/content signals, classifies high-confidence marketing separately from security/receipt/account mail, and creates a preview operation plan from policy-selected classes. Strengthen QQ ref and runtime readiness semantics before using larger batches.

**Tech Stack:** TypeScript, Vitest, pnpm, QFerry MCP plugin, QQ IMAP through imapflow.

---

## File Structure

- Modify `packages/core/src/operation-plan.ts`: add plan source metadata.
- Modify `packages/core/src/runtime-config.ts`: expose operational readiness fields.
- Modify `packages/core/src/providers/qq-readonly-provider.ts`: require `uidValidity` for QQ fetch.
- Modify `packages/core/src/providers/qq-mutable-provider.ts`: require `uidValidity` for QQ move.
- Modify `packages/core/src/tools/mail-tools.ts`: add bulk governance input/output, policy classification, and plan source limits.
- Modify `packages/core/src/mcp-server.ts`: expose a `bulk_governance_preview` tool.
- Modify tests under `packages/core/test/`: TDD for readiness, QQ uidValidity, client ref source, and bulk governance preview.
- Modify plugin docs/skill/e2e scripts after API changes.

## Tasks

### Task 1: P1 Safety Semantics

- [ ] Add failing tests for QQ refs without `uidValidity` being rejected by fetch and move.
- [ ] Add failing tests for runtime config readiness fields when QQ credentials are missing.
- [ ] Add failing tests for `planCleanup(messageRefs)` source metadata and client-ref limit.
- [ ] Implement minimal code.
- [ ] Run targeted tests.

### Task 2: Bulk Governance Preview

- [ ] Add failing tests for `bulkGovernancePreview` scanning many pages and grouping domains/classes.
- [ ] Add failing tests proving high-confidence marketing is selected while security/account mail is not.
- [ ] Implement bulk category heuristics and preview plan creation.
- [ ] Expose MCP schema.
- [ ] Run targeted tests.

### Task 3: E2E, Docs, Reload

- [ ] Update QFerry skill and acceptance docs to document large dry-run / small mutation policy.
- [ ] Add e2e summary fields for bulk dry-run where practical.
- [ ] Run `pnpm run check`.
- [ ] Run fixture and QQ readonly e2e.
- [ ] Run one small real mutation validation only if preview selects high-confidence ads and the batch is bounded.
- [ ] Run `pnpm run dev:sync-plugin-cache:all -- --apply`.
- [ ] Commit and push.
