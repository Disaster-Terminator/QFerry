# Structured Search And Urgency Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move QFerry closer to Gmail-like mailbox organization by adding structured metadata search filters and actionable inbox priority buckets to the Codex plugin.

**Architecture:** Keep the feature metadata-first and deterministic. `search` remains bounded and body-free, but gains AND-style filters for sender, subject, snippet, flag, and date. `triage_inbox` keeps existing group counts and adds explicit priority buckets with reasons and next actions, without reading message bodies or mutating QQ Mail.

**Tech Stack:** TypeScript, existing QFerry core tools, MCP server wrapper, `vitest`, plugin stdio e2e, `pnpm`.

---

## Scope Guard

This does not turn QFerry into a reply-writing app or a general email client. The vision remains:

```text
bounded QQ metadata -> search/filter -> classify -> prioritize -> preview plan -> confirmed cleanup -> trace
```

Out of scope for this slice:

- Reply drafting.
- Sending.
- Attachment handling.
- Full-body scans.
- Server-side QQ blacklist automation.
- ChatGPT App UI work.

## Gmail Workflow Research Notes

The installed Gmail skill references point to three workflow lessons for this slice:

- Search: Gmail starts triage and cleanup from precise search constraints, usually newest-first with small pages, then narrows by sender, topic, labels, dates, and unread/flag state before reading bodies.
- Triage: Gmail-style inbox review returns explicit action buckets such as urgent, needs reply soon, waiting, and FYI, with scope and confidence. QFerry maps this to metadata-only `urgent`, `needs_review`, `waiting`, `fyi`, and `bulk`.
- Labels: Gmail cleanup prefers query-driven label application or selected-message label changes. QQ Mail does not have Gmail's multi-label storage model in this plugin, so QFerry keeps classification groups local and maps confirmed cleanup to folders or future operation plans instead of claiming Gmail label parity.

## Task 1: Structured Search Filters

- [ ] Extend `SearchMessagesInput` in `packages/core/src/tools/mail-tools.ts` with `fromIncludes`, `fromDomainIncludes`, `subjectIncludes`, `snippetIncludes`, `hasFlag`, `dateAfter`, and `dateBefore`.
- [ ] Write a failing test proving `search` combines structured filters with AND semantics and does not return message bodies.
- [ ] Implement metadata-only filtering after the bounded provider scan.
- [ ] Add MCP schema fields for the new filters in `apps/chatgpt-app/src/mcp-server.ts`.
- [ ] Add MCP tests for one structured search call.

## Task 2: Urgency Triage Buckets

- [ ] Add `PriorityBucketId`, `PriorityCandidate`, and `PriorityBucket` types in `packages/core/src/tools/mail-tools.ts`.
- [ ] Write a failing unit test proving `triageInbox` returns `priorityBuckets` and `priorityCounts`.
- [ ] Implement deterministic metadata heuristics:
  - `urgent`: security alerts, urgent/deadline/action-required terms, time-pressure terms.
  - `needs_review`: direct asks, follow-ups, reply/request/question terms.
  - `waiting`: waiting/pending/follow-up state where the next blocker appears external.
  - `bulk`: newsletters, digests, unsubscribe/promo/advertising terms, seen low-priority bulk.
  - `fyi`: announcements, receipts, notifications, and default low-action mail.
- [ ] Each candidate must include message ref, sender, subject, reason, confidence, and next action.
- [ ] Keep existing `triage` shape backward-compatible.

## Task 3: Plugin E2E Evidence

- [ ] Update plugin fixture e2e summary with structured search result count and priority counts.
- [ ] Update real QQ read-only e2e summary with structured search result count and priority counts.
- [ ] Ensure QQ read-only keeps `mutationsAttempted: 0`.
- [ ] Do not log full bodies, attachments, auth secrets, or real test target domains.

## Task 4: Docs And Skill

- [ ] Update `plugins/qferry/skills/qferry/SKILL.md` to prefer structured search before body fetches and to describe priority buckets.
- [ ] Update `docs/CODEX_PLUGIN_ACCEPTANCE.md` with structured search and urgency triage evidence expectations.
- [ ] Update `docs/RETINUE_E2E_NOTES.md` with Retinue job findings from this slice.

## Task 5: Verification

- [ ] Run `pnpm run check`.
- [ ] Run `pnpm run qferry:e2e:plugin-fixture`.
- [ ] Run `pnpm run qferry:e2e:plugin-qq-readonly`.
- [ ] Run `pnpm run dev:sync-plugin-cache:all -- --apply`.
- [ ] Verify tracked files do not contain real adult-domain test targets or raw QQ account identifiers.
- [ ] Commit and push.
