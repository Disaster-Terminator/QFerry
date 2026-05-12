---
name: qferry
description: Use QFerry when Codex needs to inspect, classify, or plan safe handling of QQ Mail through read-only and preview-first mailbox tools.
---

# QFerry

QFerry is a Gmail-like QQ Mail organization plugin for Codex. Use it for mailbox governance work: listing folders, bounded metadata search, deterministic classification, and preview-only operation planning.

## Default Workflow

For real mailbox work, call tools in this order:

1. `get_status` to confirm provider, config source, account alias, read-only limits, and warnings.
2. `list_mailboxes` to discover available folders.
3. `triage_inbox` for the default Gmail-like inbox review summary.
4. `plan_cleanup` only when the user wants a preview-only operation plan from selected groups.

Use `classify_messages` when debugging rules or doing focused classification. Prefer `triage_inbox` for normal inbox organization because it returns group counts, sampled message count, recommended next action, and `mutationsAttempted`.

## Safety Boundary

Do not request real QQ Mail mutation through QFerry unless the user explicitly authorizes that specific operation. The current product milestone is read-only and preview-first.

Allowed by default:

- List folders.
- Scan bounded metadata.
- Fetch a single selected message when needed.
- Classify messages into QFerry-local groups.
- Create operation plans.
- Write trace artifacts.

## Rules

Prefer a persisted `qferry.rules.json` rules file when the user wants repeatable classification. The ruleset includes `version`, `defaultGroupId`, `groups`, and ordered `rules`.

When a tool response includes `ruleset`, keep `ruleset.version`, `ruleset.ruleCount`, and `ruleset.source` in the acceptance summary. Inline rules are still acceptable for one-off classification.

Not allowed by default:

- Move messages.
- Mark messages read or unread.
- Create QQ folders.
- Delete messages.
- Send messages.
- Download attachments.

## Trace Requirement

Every test or e2e run must produce traceable evidence under:

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/
```

Do not log auth secrets, full bodies, or attachments.
