# Gmail-like QQ Mail MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only + preview-first QFerry MVP that exposes Gmail-like mailbox tools through a ChatGPT App MCP server and a Codex plugin scaffold, with fixture and QQ read-only trace artifacts.

**Architecture:** Keep mailbox logic in `packages/core`. Add thin wrappers under `apps/chatgpt-app` and `plugins/qferry`; both call core contracts and must preserve the trace/privacy boundary.

**Tech Stack:** TypeScript, pnpm, Vitest, Node MCP/App server dependencies, Python probe tests via uv.

---

## File Structure

- `packages/core/src/tools/mail-tools.ts`: Gmail-like tool contract and handler functions over `MailProvider`.
- `packages/core/src/classification.ts`: deterministic local classification rules and explanations.
- `packages/core/src/providers/types.ts`: provider capability snapshot and bounded search/fetch contracts.
- `packages/core/src/e2e/fixture-e2e.ts`: fixture e2e extended to include capability snapshot and tool-contract calls.
- `apps/chatgpt-app/`: tool-only MCP server wrapper and fixture e2e runner.
- `plugins/qferry/`: Codex plugin metadata, MCP launcher config, skills, README, runtime dist.
- `scripts/verify-qferry-plugin.mjs`: package/plugin file verifier.
- `scripts/sync-qferry-plugin-runtime.mjs`: copy/bundle runtime into plugin-local `dist/`.
- `scripts/probe_qqmail.py` or `packages/core/src/providers/qq-readonly-provider.ts`: bounded QQ read-only probe path.

## Tasks

### Task 1: Core Tool Contract

- [ ] Write failing tests for `list_mailboxes`, `search`, `fetch`, `classify_messages`, and `plan_cleanup` using the fixture provider.
- [ ] Implement `packages/core/src/tools/mail-tools.ts`.
- [ ] Export the tool contract from `packages/core/src/index.ts`.
- [ ] Run `rtk pnpm --filter @qferry/core test`.

### Task 2: Classification Rules

- [ ] Write failing tests for sender, subject, snippet, flags, default group, and explanation output.
- [ ] Implement `packages/core/src/classification.ts`.
- [ ] Ensure classification results contain no message body.
- [ ] Run `rtk pnpm --filter @qferry/core test`.

### Task 3: Fixture E2E Artifacts

- [ ] Write failing tests that fixture e2e writes `capability-snapshot.json` in addition to existing trace, summary, and operation plan.
- [ ] Extend fixture e2e through the new tool contract.
- [ ] Run `rtk pnpm qferry:e2e:fixture`.

### Task 4: ChatGPT App MCP Server

- [ ] Add `apps/chatgpt-app` package using official Apps SDK/MCP server patterns.
- [ ] Register tool-only fixture tools first; no widget required.
- [ ] Add a fixture MCP e2e command that calls tools and writes artifacts.
- [ ] Run ChatGPT App tests and typecheck through root scripts.

### Task 5: Codex Plugin Scaffold

- [ ] Add `plugins/qferry/.codex-plugin/plugin.json`, `.mcp.json`, skill, README, and `dist/`.
- [ ] Add runtime sync and verifier scripts.
- [ ] Add package scripts so build/check ensures plugin `dist` and manifests are present.
- [ ] Run verifier under `rtk pnpm run check` or equivalent.

### Task 6: QQ Read-only E2E

- [ ] Add bounded read-only QQ provider/probe tests using mocked provider behavior.
- [ ] Implement a TypeScript or Python e2e command that logs capability snapshot and bounded metadata.
- [ ] Run against real QQ only once with small limits and `mutationsAttempted: 0`.
- [ ] If QQ blocks or times out, preserve the failure artifact and stop at that blocker.

### Task 7: Final Verification

- [ ] Run `rtk pnpm test`.
- [ ] Run `rtk pnpm run typecheck`.
- [ ] Run `rtk uv run python -m unittest tests.test_probe_qqmail`.
- [ ] Run fixture e2e and QQ read-only e2e if safe.
- [ ] Summarize artifact paths and commit/push clean changes.
