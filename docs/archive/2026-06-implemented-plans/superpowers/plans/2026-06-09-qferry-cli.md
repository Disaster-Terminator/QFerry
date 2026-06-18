# QFerry CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a terminal CLI for QFerry governance preview workflows without relying on MCP hot reload.

**Architecture:** Add a core provider factory shared by MCP and CLI, then add `apps/cli` as a thin command adapter over `createMailTools`. CLI audit mirrors MCP-style trace and summary files for real mailbox dry runs.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, tsx, `@qferry/core`.

---

### Task 1: Red CLI Tests

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/test/cli.test.ts`

- [x] Write tests for fixture `status`, audited `high-yield`, and compact `apply-ruleset-patch`.
- [x] Run `pnpm --filter @qferry/cli test` and verify the suite fails because `src/cli.ts` is missing.

### Task 2: Shared Provider Factory

**Files:**
- Create: `packages/core/src/provider-factory.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/provider-factory.test.ts`
- Modify: `apps/chatgpt-app/src/mcp-server.ts`

- [x] Add tests covering fixture provider creation and unavailable QQ provider without leaking secrets.
- [x] Implement `createMailProviderFromRuntimeConfig`.
- [x] Export the factory from core.
- [x] Replace MCP-local provider creation with the shared factory.

### Task 3: CLI Runner

**Files:**
- Create: `apps/cli/src/cli.ts`
- Create: `apps/cli/src/audit.ts`
- Modify: `package.json`

- [x] Implement the command parser and JSON output.
- [x] Implement common high-yield flags plus JSON input commands.
- [x] Implement CLI audit trace/summary for commands with `runId`.
- [x] Add root script `qferry:cli`.

### Task 4: Docs And Gates

**Files:**
- Create: `docs/CLI.md`
- Modify: `README.md`

- [x] Document terminal usage and safety boundary.
- [x] Run focused CLI tests.
- [ ] Run `pnpm run check`.
- [ ] Run real QQ read-only e2e if core/package behavior changed.
- [ ] Sync plugin cache if core/package behavior changed.
- [ ] Commit and push.
