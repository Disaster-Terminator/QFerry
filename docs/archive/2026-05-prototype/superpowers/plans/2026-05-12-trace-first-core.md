# Trace-First Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build QFerry's first TypeScript core scaffold with trace logging, operation plans, and a fixture provider.

**Architecture:** Keep mailbox logic in `packages/core` so ChatGPT App and Codex plugin wrappers can share it later. Start with fixture-only behavior and explicit operation plans before any real provider mutations.

**Tech Stack:** Node.js, TypeScript, Vitest, pnpm workspaces, uv for Python commands.

---

## File Structure

- Create `package.json`: root pnpm workspace scripts.
- Create `pnpm-workspace.yaml`: pnpm workspace package map.
- Create `tsconfig.json`: shared TypeScript config.
- Create `packages/core/package.json`: core package scripts and dependencies.
- Create `packages/core/src/index.ts`: public exports.
- Create `packages/core/src/trace.ts`: JSONL trace writer and secret redaction.
- Create `packages/core/src/operation-plan.ts`: operation-plan creation and confirmation guard model.
- Create `packages/core/src/providers/types.ts`: provider interfaces and shared message references.
- Create `packages/core/src/providers/fixture-provider.ts`: deterministic fixture mailbox provider.
- Create `packages/core/test/trace.test.ts`: trace writer tests.
- Create `packages/core/test/operation-plan.test.ts`: operation-plan tests.
- Create `packages/core/test/fixture-provider.test.ts`: fixture provider tests.

## Task 1: Initialize TypeScript Workspace

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `packages/core/package.json`

- [ ] **Step 1: Write package files**

Create root workspace scripts and core package scripts using pnpm workspaces.

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is created and `node_modules` is installed locally.

- [ ] **Step 3: Run baseline test command**

Run: `pnpm test`

Expected: fails because no test files exist yet or because package has no source. Continue to Task 2.

## Task 2: Trace Writer

**Files:**

- Create: `packages/core/test/trace.test.ts`
- Create: `packages/core/src/trace.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

Tests must verify:

- `redactSecret` never returns the raw input.
- `createRunId` creates a stable prefixable id.
- `JsonlTraceWriter.write` appends one JSON object per line and creates parent folders.

- [ ] **Step 2: Run trace test to verify RED**

Run: `pnpm --filter @qferry/core test -- trace.test.ts`

Expected: FAIL because `trace.ts` does not exist.

- [ ] **Step 3: Implement minimal trace writer**

Implement only the tested functions.

- [ ] **Step 4: Run trace test to verify GREEN**

Run: `pnpm --filter @qferry/core test -- trace.test.ts`

Expected: PASS.

## Task 3: Operation Plan Model

**Files:**

- Create: `packages/core/test/operation-plan.test.ts`
- Create: `packages/core/src/operation-plan.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

Tests must verify:

- `createOperationPlan` marks plans as `preview`.
- `confirmOperationPlan` only confirms an existing plan id.
- `confirmOperationPlan` throws when the requested id does not match.
- Plans include message refs and no full message body.

- [ ] **Step 2: Run operation plan test to verify RED**

Run: `pnpm --filter @qferry/core test -- operation-plan.test.ts`

Expected: FAIL because `operation-plan.ts` does not exist.

- [ ] **Step 3: Implement minimal operation-plan model**

Implement only plan creation and id-checked confirmation.

- [ ] **Step 4: Run operation plan test to verify GREEN**

Run: `pnpm --filter @qferry/core test -- operation-plan.test.ts`

Expected: PASS.

## Task 4: Fixture Provider

**Files:**

- Create: `packages/core/test/fixture-provider.test.ts`
- Create: `packages/core/src/providers/types.ts`
- Create: `packages/core/src/providers/fixture-provider.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

Tests must verify:

- `listMailboxes` returns fixture folders.
- `scanMailboxMetadata` returns metadata without body.
- `scanMailboxMetadata` enforces limit.
- `fetchMessage` returns body only by explicit message ref.

- [ ] **Step 2: Run fixture provider test to verify RED**

Run: `pnpm --filter @qferry/core test -- fixture-provider.test.ts`

Expected: FAIL because provider files do not exist.

- [ ] **Step 3: Implement minimal fixture provider**

Implement deterministic in-memory fixture data.

- [ ] **Step 4: Run fixture provider test to verify GREEN**

Run: `pnpm --filter @qferry/core test -- fixture-provider.test.ts`

Expected: PASS.

## Task 5: Verification And Commit

**Files:**

- Verify all touched files.

- [ ] **Step 1: Run TypeScript tests**

Run: `pnpm test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run TypeScript typecheck**

Run: `pnpm run typecheck`

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 3: Run Python probe unit tests**

Run: `uv run python -m unittest tests.test_probe_qqmail`

Expected: 4 tests pass.

- [ ] **Step 4: Check git status**

Run: `git status --short --ignored`

Expected: source/docs files are tracked or staged, sensitive local files remain ignored.

- [ ] **Step 5: Commit and push**

Run:

```bash
git add .
git commit -m "Add trace-first TypeScript core scaffold"
git push
```

Expected: private remote `origin/main` receives the commit.
