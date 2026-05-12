# Rules Preview Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persisted classification ruleset path that can drive classification and preview-only cleanup plans while preserving trace artifacts.

**Architecture:** Keep rule parsing in `packages/core`, keep mailbox operations read-only, and expose `rulesFile` as an optional tool input that resolves to explicit rules before classification. E2E summaries record the ruleset version and keep `mutationsAttempted: 0`.

**Tech Stack:** TypeScript, Vitest, MCP SDK, pnpm, uv for Python checks.

---

### Task 1: Ruleset Parser

**Files:**
- Create: `packages/core/src/ruleset.ts`
- Test: `packages/core/test/ruleset.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] Write failing tests for parsing a JSON ruleset with groups and rules, rejecting empty rules, and returning metadata.
- [ ] Run `rtk pnpm --filter @qferry/core test -- ruleset.test.ts` and confirm the tests fail because `ruleset.ts` does not exist.
- [ ] Implement `parseClassificationRuleset` and `loadClassificationRuleset`.
- [ ] Export the ruleset helpers from `packages/core/src/index.ts`.
- [ ] Run the ruleset tests and confirm they pass.

### Task 2: Tool Inputs Support `rulesFile`

**Files:**
- Modify: `packages/core/src/tools/mail-tools.ts`
- Test: `packages/core/test/mail-tools.test.ts`
- Modify: `apps/chatgpt-app/src/mcp-server.ts`

- [ ] Write failing tests showing `classifyMessages` and `planCleanup` load rules from `rulesFile`.
- [ ] Run `rtk pnpm --filter @qferry/core test -- mail-tools.test.ts` and confirm the new tests fail because `rulesFile` is unsupported.
- [ ] Resolve rules from either inline `rules` or `rulesFile`; preserve inline behavior.
- [ ] Add `ruleset` metadata to classification and plan responses.
- [ ] Update MCP schemas so `rulesFile` is optional and `rules` remains supported.
- [ ] Run core tests and app typecheck.

### Task 3: E2E Trace Evidence

**Files:**
- Create: `examples/qferry.rules.json`
- Modify: `scripts/run-qferry-plugin-fixture-e2e.mjs`
- Modify: `scripts/run-qferry-plugin-qq-readonly-e2e.mjs`

- [ ] Add an example ruleset used by fixture e2e.
- [ ] Update fixture e2e to call classification and cleanup with `rulesFile`.
- [ ] Update e2e summaries to record `rulesetVersion`, `rulesetRuleCount`, and `mutationsAttempted: 0`.
- [ ] Keep QQ read-only e2e bounded and read-only; do not add mutations.
- [ ] Run `rtk pnpm qferry:e2e:plugin-fixture` and `rtk pnpm qferry:e2e:plugin-qq-readonly`.

### Task 4: Verification And Commit

**Files:**
- Modify docs if needed after behavior stabilizes.

- [ ] Run `rtk pnpm run check`.
- [ ] Run `rtk uv run python -m unittest tests.test_probe_qqmail`.
- [ ] Inspect generated summary files for traceability and no secrets.
- [ ] Commit and push the focused change.
