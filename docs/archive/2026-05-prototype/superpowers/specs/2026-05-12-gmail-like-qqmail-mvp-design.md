# Gmail-like QQ Mail MVP Design

Date: 2026-05-12

## Goal

Build QFerry as a Gmail-like QQ Mail app with two product surfaces: a ChatGPT App and a Codex plugin. The first usable milestone is read-only and preview-first: QFerry can inspect bounded mailbox data, classify messages into user-defined groups, create reviewable operation plans, and leave trace artifacts for every test or e2e run.

## Product Boundary

QFerry is not a general mail client and not primarily a reply-writing tool. The first-class workflow is:

```text
list folders -> scan bounded metadata -> classify -> explain -> plan handling/archive -> preview -> trace
```

Real QQ Mail mutation is out of scope for this milestone. No move, mark, folder creation, deletion, send, attachment download, or large body scan is allowed against the user's real QQ mailbox.

## Architecture

The shared implementation stays in `packages/core`. The ChatGPT App and Codex plugin are wrappers over the same core contracts.

```text
packages/core
  provider contracts
  Gmail-like tool contract
  classification rules
  operation plans
  trace writer
  fixture provider
  QQ read-only provider/probe

apps/chatgpt-app
  tool-only MCP server for fixture/QQ read-only flows
  later optional widget

plugins/qferry
  Codex plugin metadata, skills, MCP launcher, dist sync/checks
```

The ChatGPT App starts as `tool-only`. Official Apps SDK docs say a ChatGPT app requires an MCP server and may optionally include a web component UI; the server owns tools, auth, data, and UI links. QFerry does not need a widget to validate the mailbox tool contract.

## Tool Contract

The first tool surface should be close to Gmail behavior without copying Gmail's storage model:

- `search`: read-only metadata search over a provider with bounded limits.
- `fetch`: read-only single-message detail fetch by opaque message reference.
- `list_mailboxes`: read-only provider folder discovery.
- `classify_messages`: local classification into QFerry groups.
- `plan_cleanup`: preview-only operation plan generation.

All read tools must declare read-only behavior in wrapper metadata. Mutating tools are not exposed for QQ in this milestone.

## Classification Rules

Custom groups are QFerry-local by default. A group may later map to a provider target such as a QQ folder, but that mapping is inactive until provider mutation capability is explicitly proven.

Rules are deterministic in the MVP: match sender, subject, snippet, flags, or folder fields. The result must explain which rule matched each message so the user can audit classification quality.

## Trace And Privacy

Every e2e run writes:

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
artifacts/e2e/<runId>/capability-snapshot.json
artifacts/e2e/<runId>/operation-plan.json
```

Default privacy rules:

- Do not log auth secrets.
- Do not log full message body.
- Do not log attachments.
- Prefer message references, folder names, counts, and short redacted previews.
- Always log whether mutation was allowed and how many mutations were attempted.

## QQ Read-only E2E

The QQ path uses the configured `.env` values but must remain bounded:

- Login and list mailbox capability.
- List folders.
- Scan at most a small configured metadata limit.
- Optionally fetch one selected message only when needed to prove `fetch`.
- Write artifacts with `mutationsAttempted: 0`.

If QQ login, IMAP behavior, rate limiting, or server timeout blocks progress, the run must fail with a traceable artifact rather than retrying aggressively.

## Codex Plugin Shape

The plugin follows the `G:\repository\supervisor` packaging pattern:

- Plugin-local `.codex-plugin/plugin.json`.
- Plugin-local `.mcp.json`.
- Plugin skills and README.
- Plugin-local `dist/` runtime copied or bundled from source.
- A verifier that fails when plugin manifests, skills, or `dist` runtime are missing.

The plugin is not allowed to point at an unbuilt source checkout as its runtime.

## Acceptance

This milestone is complete when:

- Unit tests pass with `rtk pnpm test`.
- TypeScript checks pass with `rtk pnpm run typecheck`.
- Python probe tests pass with `rtk uv run python -m unittest tests.test_probe_qqmail`.
- Fixture e2e produces trace, summary, capability snapshot, and operation plan artifacts.
- ChatGPT App MCP fixture e2e proves tool calls without a widget.
- Codex plugin scaffold validates required files and runtime artifacts.
- QQ read-only e2e either succeeds with bounded artifacts or stops with a traceable blocker requiring user input.
