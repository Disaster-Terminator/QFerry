# QFerry Codex Plugin First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the QFerry Codex plugin locally installable, discoverable, and testable through plugin-local runtime e2e for fixture and QQ read-only workflows.

**Architecture:** Freeze browser/ChatGPT App testing. Move plugin runtime from a `tsx` launcher to a plugin-local bundled MCP runtime, then verify it through `.mcp.json` and Codex-oriented e2e logs.

**Tech Stack:** TypeScript, pnpm, Vitest, MCP SDK, esbuild bundle, Python `uv` for the existing QQ read-only probe.

---

## Boundary

Do not add browser tests, HTTPS tunnels, ChatGPT App connector setup, widgets, or App submission work in this milestone. Real QQ Mail mutation remains forbidden. Low-risk e2e may run against fixture and QQ read-only paths only.

## Commit Strategy

Use staged commits:

1. Commit plugin runtime bundling and verifier changes after tests pass.
2. Commit plugin-local fixture e2e after it runs through `.mcp.json`.
3. Commit QQ read-only plugin/provider integration after bounded e2e succeeds or leaves a traceable blocker.

## Tasks

### Task 1: Plugin Runtime Bundle

- [ ] Add a failing verifier/test that rejects a plugin runtime which references `tsx`, `apps/chatgpt-app/src`, or repo source paths.
- [ ] Replace `plugins/qferry/src/mcp.js` with a TypeScript or JavaScript plugin runtime entry that can be bundled.
- [ ] Update `scripts/sync-qferry-plugin-runtime.mjs` to build plugin-local `plugins/qferry/dist/mcp.js` with esbuild.
- [ ] Update verifier to prove `dist/mcp.js` exists and does not contain source-launcher references.
- [ ] Run `rtk pnpm run verify:qferry-plugin` and `rtk pnpm run check`.
- [ ] Commit runtime bundling.

### Task 2: Plugin-local Fixture MCP E2E

- [ ] Add an e2e runner that reads `plugins/qferry/.mcp.json`, starts `node ./dist/mcp.js` from the plugin directory, and talks MCP over stdio.
- [ ] Call `list_mailboxes`, `search`, `classify_messages`, and `plan_cleanup`.
- [ ] Write `logs/runs/<runId>.jsonl` and `artifacts/e2e/<runId>/summary.md`.
- [ ] Add root script `qferry:e2e:plugin-fixture`.
- [ ] Run the script and commit.

### Task 3: QQ Read-only Plugin Path

- [ ] Add provider selection through environment: fixture default, QQ read-only only when `QFERRY_PROVIDER=qqmail`.
- [ ] Keep QQ tool limits bounded and mutation disabled.
- [ ] Reuse the existing Python probe for low-risk QQ network proof if a full TypeScript IMAP adapter would enlarge the milestone too much.
- [ ] Add plugin e2e evidence that records QQ read-only capability/probe artifacts and `mutationsAttempted: 0`.
- [ ] Run once against QQ with sample limit 1. If blocked, preserve artifacts and stop.
- [ ] Commit QQ read-only path.

### Task 4: Final Verification

- [ ] Run `rtk pnpm run check`.
- [ ] Run `rtk pnpm qferry:e2e:plugin-fixture`.
- [ ] Run QQ read-only probe/e2e once if safe.
- [ ] Run `rtk uv run python -m unittest tests.test_probe_qqmail`.
- [ ] Confirm `git status --short` is clean after commits.
- [ ] Push `main`.
