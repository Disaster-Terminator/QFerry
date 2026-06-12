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
5. Build or reuse a persisted `qferry.rules.json` ruleset when the work is repeatable. Groups should be user-defined and may bind `target.folder`; do not invent hardcoded product categories as the durable model. If `get_status` reports `rulesFile`, governance tools can use it by default when no inline `rules` or explicit `rulesFile` is passed.
6. `plan_mailbox_governance_campaign` when the ruleset is not mature and multiple folders may contain useful sender/domain candidates. Pass an explicit folder list; it ranks folders by high-yield opportunity and returns `stop_low_yield` when the whole campaign is not worth more agent time.
7. `plan_high_yield_governance` before spending agent time on one folder. It scans a bounded metadata window, ranks sender/domain candidates by yield, drafts local rules only for low-risk domains, flags broad mixed domains for `sender_breakdown`, and returns `stop_low_yield` when continuing would be micro-operations.
8. `ruleset_governance_campaign_preview` once a persisted ruleset exists and the user wants efficient multi-folder governance. It applies the same user-defined ruleset across explicit folders, returns compact folder coverage and operation plan ids, and does not return full classifications or message refs. Use it to decide whether to confirm plans, review rules, or stop low-yield work.
9. `ruleset_governance_preview` for a focused single-folder plan after the campaign identifies a useful folder/group, or when debugging one target folder. It applies the ruleset, groups matching metadata by user-defined group, and creates preview operation plans per target group. It defaults to compact output; pass `includeClassifications: true` only when debugging individual rule matches.
10. `classification_sweep` and `classification_map` only for exploratory built-in heuristic discovery when the ruleset is not yet clear. Treat their `workflowWarning.code: "legacy_discovery_helper"` as a prompt to convert discoveries into rules.
11. `ensure_classification_folder` after a user group or target folder is selected and before planning moves. Pass a short user-facing folder name such as `广告营销` or `开发社区`; QFerry maps it to the QQ IMAP path such as `其他文件夹/广告营销` and returns a preview `create_folder` plan if the folder is missing.
12. `bulk_governance_preview` only for legacy built-in category preview. Prefer `ruleset_governance_campaign_preview` or `ruleset_governance_preview` for repeatable governance.
13. `triage_inbox` for a small inbox review summary and urgency buckets.
14. `group_spam_candidates` only for narrow spam/ad spot checks. Present the grouped candidates for confirmation before any real operation.
15. `preview_cleanup_batch` when the user already has explicit rules and wants a single bounded operation plan.
16. `plan_cleanup` only when the user wants a preview-only operation plan from selected groups or already reviewed message refs. Direct `messageRefs` plans are limited and marked as `source: "client_refs"`.
17. `confirm_cleanup_plan` only after the user explicitly approves one specific preview plan.
18. `execute_cleanup` only with the confirmed `operationPlanId`; never pass or fabricate a `status: "confirmed"` plan object. For move plans, the installed MCP server executes at most 5 messages by default and keeps a partially executed plan resumable under the same `operationPlanId`; call `execute_cleanup` again to continue remaining messages only when the result recommends `continue_plan`. If the result includes `reconciliationRisk: "severe_source_count_drift"` or `recommendedNextAction: "refresh_preview"`, discard the remaining refs from that old plan and generate a fresh preview for the current mailbox state. You may pass `maxMessages` from 1 to 50 for controlled experiments. Use 20 for real QQ Mail while validating a new category, and use 50 only after target-folder reconciliation has been stable for that workflow.

Use `classify_messages` when debugging rules or doing focused classification. Prefer `triage_inbox` for normal inbox organization because it returns group counts, priority buckets (`urgent`, `needs_review`, `waiting`, `fyi`, `bulk`), sampled message count, recommended next action, and `mutationsAttempted`.

## Safety Boundary

Do not request real QQ Mail mutation through QFerry unless the user explicitly authorizes that specific operation. The default product workflow is read-only and preview-first; mutation requires a server-side plan generated in this MCP session, `confirm_cleanup_plan`, and then `execute_cleanup`. Large confirmed move plans are checkpointed: `execute_cleanup` returns `partially_executed` with `remainingMessages` when more refs remain, and the same `operationPlanId` can be executed again until it returns `executed`.

Allowed by default:

- List folders.
- Scan bounded metadata.
- Search with metadata filters before considering body fetches.
- Fetch a single selected message when needed.
- Classify messages into QFerry-local groups.
- Use `ruleset_governance_campaign_preview` as the default high-throughput governance entry once a ruleset exists and more than one explicit folder is in scope.
- Use `ruleset_governance_preview` for focused single-folder governance or bounded rule debugging.
- Use `classification_sweep` and `classification_map` as legacy discovery helpers only; convert useful discoveries into user rules and folders before repeatable execution.
- Preview missing classification folders with `ensure_classification_folder`. Do not expose meaningless prefixes in the suggested display name; use `其他文件夹/...` only as the IMAP execution path.
- Dry-run legacy built-in category windows with `bulk_governance_preview` only when discovery output is still being reviewed. For repeatable mailbox cleanup, prefer ruleset-backed group targets over built-in category IDs. Do not default advertising or marketing mail to `Junk`; classify it into a reviewable folder such as `广告营销` unless the user explicitly asks for Junk.
- Group oldest obvious spam or ads for confirmation.
- Create operation plans.
- Preview bounded cross-page cleanup batches.
- Plan sender/domain governance candidates and local rule suggestions.
- Run `ruleset_governance_campaign_preview` to choose which explicit folders are worth executing, reviewing, or stopping when the ruleset already exists. Do not use it as an unbounded whole-account crawler.
- Run `plan_mailbox_governance_campaign` to discover high-yield sender/domain rule candidates before the ruleset covers the mailbox.
- Run `plan_high_yield_governance` to decide whether a folder has enough repeatable signal to justify batch governance. Treat `stop_low_yield` as a reason to stop mailbox cleanup and improve rules later instead of doing manual micro-moves.
- Break noisy domains down by concrete sender with `sender_breakdown` before moving anything. This is the preferred first step for mixed domains such as `qq.com`, where a domain-level rule would merge system mail, product mail, personal QQ senders, and bounce notices.
- Write trace artifacts.
- Confirm an operation plan after explicit user approval.

## Rules

Prefer a persisted `qferry.rules.json` rules file when the user wants repeatable classification. The ruleset includes `version`, `defaultGroupId`, `groups`, and ordered `rules`. A group may include `target.folder` to bind a user-defined classification group to a QQ folder. When `preview_cleanup_batch` selects exactly one group with a configured target and no explicit `target` is provided, QFerry uses that group target and records `selectedGroupTargets` in audit output.

QFerry can discover a default persisted ruleset from `QFERRY_RULES_FILE` or local `config.json` `rulesFile`. Explicit tool `rulesFile` and inline `rules` still take precedence. Use the default ruleset for repeatable mailbox governance so the agent does not have to restate the full rules every turn.

Rules can match `fromIncludes`, `fromDomainIncludes`, `subjectIncludes`, `snippetIncludes`, `folderEquals`, and `hasFlag` without reading message bodies.

Rules may include optional `priority` metadata with `bucketId`, `reason`, `confidence`, `weight`, and `nextAction`. Use it to make user-specific senders/domains consistently land in `urgent`, `needs_review`, `waiting`, `fyi`, or `bulk` without changing QQ server state. `weight` is a 0-100 candidate ordering signal inside the selected bucket.

Use `plan_sender_governance` when the user wants Gmail-like sender/domain cleanup. It returns compact domain candidates, `candidateSummary`, suggested local rules, `rulesetPatch.rulesToAdd` for explicitly selected sender/domain filters, duplicate-rule skips, `rulesetPatch.renderedDraft`, `rulesetPatch.changelog`, a preview-only operation plan, and `serverBlocklistCapability.supported: false` when the current provider exposes no QQ server-side blocklist mutation API. Pass `ruleGroup` when the selected senders should become a reusable user classification instead of generic sender governance, for example `{ "id": "ai_dev_tools", "label": "AI开发工具", "target": { "folder": "其他文件夹/AI开发工具" } }`. This drafts rules directly into that user-defined group and keeps the folder binding in the local ruleset draft; it still does not mutate QQ Mail. For QQ Mail classification moves, a bare target such as `{ "folder": "GitHub通知" }` is resolved to the user-folder path under `其他文件夹`; use `folderMode: "literal"` only when deliberately targeting a root-level mailbox.

Use `sender_breakdown` before `plan_sender_governance` when a single domain is too broad. Pass `fromDomainIncludes` such as `qq.com` and a target `ruleGroup`; review the returned concrete `senderCandidates`, `sampleSubjects`, and `suggestedRule.match.fromIncludes`. Then pass only the approved sender strings to `plan_sender_governance.selectedFromIncludes` for preview and execution. `sender_breakdown` is read-only and does not create an operation plan.

For high-throughput sender or rule cleanup, prefer one window-backed campaign preview over manual offset stitching. Pass enough `pageSize * maxPagesPerFolder` to cover each explicit target folder window, then use `ruleset_governance_campaign_preview` against the persisted ruleset for all matching groups and folders. If the campaign shows weak coverage, use `plan_sender_governance` with `ruleGroup` to draft reusable classification rules for recurring domains, dry-run the patch with `apply_ruleset_patch`, and rerun the campaign. These tools use the provider bulk metadata window when available, so they should produce UID-ref operation plans for user-defined groups instead of requiring multiple `scanOffset` retries.

When iterating outside MCP or trying to avoid Codex plugin reloads, prefer the repo-local CLI workflow before spending agent tokens on manual mailbox governance:

```powershell
rtk pnpm run qferry:cli -- campaign-workflow --input .\workflow.json
```

This command chains multi-folder high-yield discovery, local ruleset patch validation/application, and ruleset campaign preview. It does not call `confirm_cleanup_plan` or `execute_cleanup`; `applyRulesetPatch: true` writes only the local `qferry.rules.json` file and is not a QQ Mail mutation.

If the CLI workflow returns `mixedDomainNextSteps`, run the suggested `qferry sender-breakdown` command before drafting sender/domain rules. When using the repo-local CLI for rule iteration, prefer `breakdownMixedDomains.enabled: true` in `campaign-workflow` to fold that read-only sender breakdown into the same workflow. This returns sender-level candidate evidence by default. Set `breakdownMixedDomains.draftSenderRules: true` only when the current `ruleGroup` is already the intended classification target for those senders; then the workflow may merge sender-level suggested rules into the local ruleset patch and preview the dry-run draft without writing the rules file.

Prefer `ruleset_governance_campaign_preview` over repeated single-folder calls when a user ruleset already exists. It is the token-efficient Gmail-like path: one compact response ranks explicit folders by coverage and executable plan opportunities, while preserving operation plan ids for later confirmation.

Before drafting sender/domain rules, use `plan_mailbox_governance_campaign` when comparing multiple explicit folders, or `plan_high_yield_governance` for one folder, with a practical `minMessageCount` such as 10 or 20. These discovery tools intentionally return a compact `rulesetPatch` plus `changelog` without `renderedDraft`; call `apply_ruleset_patch` with `apply: false` for the selected patch when validation is needed, and pass `includeRenderedDraft: true` only when the full merged draft is worth the token cost. Draft rules only for candidates whose `recommendedAction` is `draft_domain_rule`; for `break_down_sender`, call `sender_breakdown` and choose concrete senders instead. If `recommendedNextAction` is `stop_low_yield`, stop real mailbox governance for that folder or campaign rather than spending tokens on long-tail cleanup.

Keep `ruleset_governance_preview` compact by default during real mailbox治理. Review `campaignReport`, `topUnplannedDomains`, `topUnplannedSenders`, `groupPlans`, `skippedGroups`, and operation plan ids first; request `includeClassifications: true` only for a bounded debug pass when a rule behaves unexpectedly. If `skippedGroups.reason` is `target_is_source_folder`, treat it as an intentional no-op skip: the matched messages are already in the group's target folder, so do not confirm or execute a move for that group.

Use `classification_sweep` and `classification_map` only before the ruleset is mature enough to govern repeatably. They return compact built-in heuristic signals without creating durable user categories. After a useful pattern is found, express it as a rule group with a target folder and switch to `ruleset_governance_preview`. For real QQ Mail, execute only a confirmed subset after reviewing the rules, folder plan, and move plan.

For GitHub-heavy inbox治理, do not put all `github.com` mail into one broad folder. Prefer `github_ci` -> `GitHub CI`, `github_pr_notification` -> `GitHub PR通知`, `github_code_review` -> `GitHub代码审查`, and `github_account_security` -> `GitHub账号安全`, then move only reviewed preview plans.

For real QQ Mail after any move batch, treat `classification_sweep` counts and `nextScanOffset` as advisory only. QQ IMAP sequence windows and `INBOX exists` can fold after moves, so a later `scanOffset: 0` preview may see a different current front window. Use `ruleset_governance_preview` or `bulk_governance_preview` `selectedMessageRefs`, `preview.mailboxSnapshot`, and generated UID refs as the authoritative execution input. Do not claim a category tail is fully exhausted solely from a prior sweep; re-preview the chosen group/category and rely on target-folder reconciliation after execution.

Use `apply_ruleset_patch` only for local QFerry rules files. Default to `apply: false` for review. Its response is compact by default; pass `includeRenderedDraft: true` only when the full merged draft must be inspected. It can append new rules with `rulesToAdd` and replace stale broad rules by id with `rulesToReplace`; replacements keep the original rule order and fail when the requested rule id is missing, so they do not silently become append-only patches. `apply: true` writes the local rules file but does not mutate QQ Mail, labels, folders, messages, or server-side blocklists.

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
