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
5. `classification_sweep` for Gmail-like large mailbox governance. Use it to progressively scan chunks and return compact aggregate category counts plus `hasMore` / `resumeToken` / `nextScanOffset`, without message refs or an operation plan.
6. `classification_map` for bounded classification detail. Use it on a selected window when you need category buckets, recommended actions, and sender/domain candidates.
7. `ensure_classification_folder` after a bucket is selected and before planning moves. Pass a short user-facing folder name such as `广告营销` or `开发社区`; QFerry maps it to the QQ IMAP path such as `其他文件夹/广告营销` and returns a preview `create_folder` plan if the folder is missing.
8. `bulk_governance_preview` only after the user or workflow has selected one or more classification buckets and a target classification folder for a dry-run operation plan.
9. `triage_inbox` for a small inbox review summary and urgency buckets.
10. `group_spam_candidates` only for narrow spam/ad spot checks. Present the grouped candidates for confirmation before any real operation.
11. `preview_cleanup_batch` when the user already has explicit rules and wants a cross-page bounded operation plan.
12. `plan_cleanup` only when the user wants a preview-only operation plan from selected groups or already reviewed message refs. Direct `messageRefs` plans are limited and marked as `source: "client_refs"`.
12. `confirm_cleanup_plan` only after the user explicitly approves one specific preview plan.
13. `execute_cleanup` only with the confirmed `operationPlanId`; never pass or fabricate a `status: "confirmed"` plan object. For move plans, the installed MCP server executes at most 5 messages by default and keeps a partially executed plan resumable under the same `operationPlanId`; call `execute_cleanup` again to continue remaining messages. You may pass `maxMessages` from 1 to 50 for controlled experiments. Use 20 for real QQ Mail while validating a new category, and use 50 only after target-folder reconciliation has been stable for that workflow.

Use `classify_messages` when debugging rules or doing focused classification. Prefer `triage_inbox` for normal inbox organization because it returns group counts, priority buckets (`urgent`, `needs_review`, `waiting`, `fyi`, `bulk`), sampled message count, recommended next action, and `mutationsAttempted`.

## Safety Boundary

Do not request real QQ Mail mutation through QFerry unless the user explicitly authorizes that specific operation. The default product workflow is read-only and preview-first; mutation requires a server-side plan generated in this MCP session, `confirm_cleanup_plan`, and then `execute_cleanup`. Large confirmed move plans are checkpointed: `execute_cleanup` returns `partially_executed` with `remainingMessages` when more refs remain, and the same `operationPlanId` can be executed again until it returns `executed`.

Allowed by default:

- List folders.
- Scan bounded metadata.
- Search with metadata filters before considering body fetches.
- Fetch a single selected message when needed.
- Classify messages into QFerry-local groups.
- Build a classification-first mailbox sweep with `classification_sweep`; treat this as the default starting point for large cleanup work. Continue with `resumeToken.offset` or `nextScanOffset` until the sweep is complete.
- Use `classification_map` for bounded detail after the sweep has identified a window or category worth inspecting.
- Preview missing classification folders with `ensure_classification_folder`. Do not expose meaningless prefixes in the suggested display name; use `其他文件夹/...` only as the IMAP execution path.
- Dry-run large mailbox windows with `bulk_governance_preview`; prefer categories such as `high_confidence_marketing`, `newsletter_or_digest`, `security_or_account`, `receipt_or_purchase`, GitHub-specific buckets (`github_ci`, `github_pr_notification`, `github_code_review`, `github_account_security`), and `developer_community` over manual UID picking. Do not default advertising or marketing mail to `Junk`; classify it into a reviewable folder such as `广告营销` unless the user explicitly asks for Junk.
- Group oldest obvious spam or ads for confirmation.
- Create operation plans.
- Preview bounded cross-page cleanup batches.
- Plan sender/domain governance candidates and local rule suggestions.
- Break noisy domains down by concrete sender with `sender_breakdown` before moving anything. This is the preferred first step for mixed domains such as `qq.com`, where a domain-level rule would merge system mail, product mail, personal QQ senders, and bounce notices.
- Write trace artifacts.
- Confirm an operation plan after explicit user approval.

## Rules

Prefer a persisted `qferry.rules.json` rules file when the user wants repeatable classification. The ruleset includes `version`, `defaultGroupId`, `groups`, and ordered `rules`. A group may include `target.folder` to bind a user-defined classification group to a QQ folder. When `preview_cleanup_batch` selects exactly one group with a configured target and no explicit `target` is provided, QFerry uses that group target and records `selectedGroupTargets` in audit output.

Rules can match `fromIncludes`, `fromDomainIncludes`, `subjectIncludes`, `snippetIncludes`, `folderEquals`, and `hasFlag` without reading message bodies.

Rules may include optional `priority` metadata with `bucketId`, `reason`, `confidence`, `weight`, and `nextAction`. Use it to make user-specific senders/domains consistently land in `urgent`, `needs_review`, `waiting`, `fyi`, or `bulk` without changing QQ server state. `weight` is a 0-100 candidate ordering signal inside the selected bucket.

Use `plan_sender_governance` when the user wants Gmail-like sender/domain cleanup. It returns compact domain candidates, `candidateSummary`, suggested local rules, `rulesetPatch.rulesToAdd` for explicitly selected sender/domain filters, duplicate-rule skips, `rulesetPatch.renderedDraft`, `rulesetPatch.changelog`, a preview-only operation plan, and `serverBlocklistCapability.supported: false` when the current provider exposes no QQ server-side blocklist mutation API. Pass `ruleGroup` when the selected senders should become a reusable user classification instead of generic sender governance, for example `{ "id": "ai_dev_tools", "label": "AI开发工具", "target": { "folder": "其他文件夹/AI开发工具" } }`. This drafts rules directly into that user-defined group and keeps the folder binding in the local ruleset draft; it still does not mutate QQ Mail. For QQ Mail classification moves, a bare target such as `{ "folder": "GitHub通知" }` is resolved to the user-folder path under `其他文件夹`; use `folderMode: "literal"` only when deliberately targeting a root-level mailbox.

Use `sender_breakdown` before `plan_sender_governance` when a single domain is too broad. Pass `fromDomainIncludes` such as `qq.com` and a target `ruleGroup`; review the returned concrete `senderCandidates`, `sampleSubjects`, and `suggestedRule.match.fromIncludes`. Then pass only the approved sender strings to `plan_sender_governance.selectedFromIncludes` for preview and execution. `sender_breakdown` is read-only and does not create an operation plan.

For high-throughput sender or rule cleanup, prefer one window-backed preview over manual offset stitching. Pass enough `pageSize * maxPages` to cover the target mailbox window, then use `plan_sender_governance` with `ruleGroup` to draft reusable classification rules for recurring domains, dry-run the patch with `apply_ruleset_patch`, and use `preview_cleanup_batch` against the ruleset for all matching messages. These tools use the provider bulk metadata window when available, so they should produce a single UID-ref operation plan for a category such as Steam instead of requiring multiple `scanOffset` retries.

Use `classification_sweep` before high-throughput mailbox治理. It returns compact aggregate category counts, chunk summaries, bucket summaries, and `nextScanOffset` without message refs or a plan, so large real mailboxes can be classified first without flooding context. Use `classification_map` only when you need bounded window details. After selecting buckets such as `high_confidence_marketing`, `newsletter_or_digest`, `security_or_account`, `receipt_or_purchase`, GitHub-specific buckets, and `developer_community`, call `ensure_classification_folder` for the target folder name, then use `bulk_governance_preview` with the same display name or the returned full folder path. For real QQ Mail, execute only a confirmed subset after reviewing the categories, folder plan, and move plan.

For GitHub-heavy inbox治理, do not put all `github.com` mail into one broad folder. Prefer `github_ci` -> `GitHub CI`, `github_pr_notification` -> `GitHub PR通知`, `github_code_review` -> `GitHub代码审查`, and `github_account_security` -> `GitHub账号安全`, then move only reviewed preview plans.

For real QQ Mail after any move batch, treat `classification_sweep` counts and `nextScanOffset` as advisory only. QQ IMAP sequence windows and `INBOX exists` can fold after moves, so a later `scanOffset: 0` preview may see a different current front window. Use `bulk_governance_preview.selectedMessageRefs`, `preview.mailboxSnapshot`, and the generated UID refs as the authoritative execution input. Do not claim a category tail is fully exhausted solely from a prior sweep; re-preview the chosen category and rely on target-folder reconciliation after execution.

Use `apply_ruleset_patch` only for local QFerry rules files. Default to `apply: false` for review. `apply: true` writes the local rules file but does not mutate QQ Mail, labels, folders, messages, or server-side blocklists.

When a tool response includes `ruleset`, keep `ruleset.version`, `ruleset.ruleCount`, and `ruleset.source` in the acceptance summary. Inline rules are still acceptable for one-off classification.

Not allowed by default:

- Move messages without an approved and server-confirmed plan.
- Mark messages read or unread.
- Create QQ folders without an approved `create_folder` plan.
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
