---
name: qferry
description: Use QFerry when Codex needs to inspect, classify, or plan safe handling of QQ Mail through read-only and preview-first mailbox tools.
---

# QFerry

QFerry is a Gmail-like QQ Mail organization plugin for Codex. Use it for mailbox governance work: listing folders, bounded metadata search, deterministic classification, and preview-only operation planning.

## Default Workflow

For real mailbox work, call tools in this order:

1. `get_status` to confirm provider, config source, account alias, read-only limits, mutation capability, confirmation requirement, and warnings.
2. `list_mailboxes` to discover available folders.
3. `get_mailbox_summary` to get read-only folder counts before scanning.
4. `search` with structured filters when the task can be narrowed by sender, domain, subject, snippet, flag, date, order, or offset.
5. `triage_inbox` for the default Gmail-like inbox review summary and urgency buckets.
6. `group_spam_candidates` when the user wants to start from oldest obvious spam or ads. Present the grouped candidates for confirmation before any real operation.
7. `preview_cleanup_batch` when the user wants a cross-page rules preview and a bounded operation plan.
8. `plan_cleanup` only when the user wants a preview-only operation plan from selected groups or already reviewed message refs.
9. `confirm_cleanup_plan` only after the user explicitly approves one specific preview plan.
10. `execute_cleanup` only with the confirmed `operationPlanId`; never pass or fabricate a `status: "confirmed"` plan object.

Use `classify_messages` when debugging rules or doing focused classification. Prefer `triage_inbox` for normal inbox organization because it returns group counts, priority buckets (`urgent`, `needs_review`, `waiting`, `fyi`, `bulk`), sampled message count, recommended next action, and `mutationsAttempted`.

## Safety Boundary

Do not request real QQ Mail mutation through QFerry unless the user explicitly authorizes that specific operation. The default product workflow is read-only and preview-first; mutation requires a server-side plan generated in this MCP session, `confirm_cleanup_plan`, and then `execute_cleanup`.

Allowed by default:

- List folders.
- Scan bounded metadata.
- Search with metadata filters before considering body fetches.
- Fetch a single selected message when needed.
- Classify messages into QFerry-local groups.
- Group oldest obvious spam or ads for confirmation.
- Create operation plans.
- Preview bounded cross-page cleanup batches.
- Plan sender/domain governance candidates and local rule suggestions.
- Write trace artifacts.
- Confirm an operation plan after explicit user approval.

## Rules

Prefer a persisted `qferry.rules.json` rules file when the user wants repeatable classification. The ruleset includes `version`, `defaultGroupId`, `groups`, and ordered `rules`.

Rules can match `fromIncludes`, `fromDomainIncludes`, `subjectIncludes`, `snippetIncludes`, `folderEquals`, and `hasFlag` without reading message bodies.

Rules may include optional `priority` metadata with `bucketId`, `reason`, `confidence`, `weight`, and `nextAction`. Use it to make user-specific senders/domains consistently land in `urgent`, `needs_review`, `waiting`, `fyi`, or `bulk` without changing QQ server state. `weight` is a 0-100 candidate ordering signal inside the selected bucket.

Use `plan_sender_governance` when the user wants Gmail-like sender/domain cleanup. It returns domain candidates, suggested local rules, `rulesetPatch.rulesToAdd` for explicitly selected sender/domain filters, duplicate-rule skips, `rulesetPatch.renderedDraft`, `rulesetPatch.changelog`, a preview-only operation plan, and `serverBlocklistCapability.supported: false` when the current provider exposes no QQ server-side blocklist mutation API.

Use `apply_ruleset_patch` only for local QFerry rules files. Default to `apply: false` for review. `apply: true` writes the local rules file but does not mutate QQ Mail, labels, folders, messages, or server-side blocklists.

When a tool response includes `ruleset`, keep `ruleset.version`, `ruleset.ruleCount`, and `ruleset.source` in the acceptance summary. Inline rules are still acceptable for one-off classification.

Not allowed by default:

- Move messages without an approved and server-confirmed plan.
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
