# QFerry Research Notes

Date: 2026-05-12

## Current Goal

QFerry should prioritize mailbox organization, classification, detection, cleanup, and archive workflows for existing QQ Mail messages. Reply drafting is a secondary feature, not the first-class product goal.

The core user flow is:

```text
scan mailbox -> classify messages -> explain why -> propose cleanup/archive plan -> preview changes -> user confirms -> execute -> write trace artifacts
```

Every testable run must leave evidence that can be reviewed after the fact. The user should not have to describe what happened manually.

## Product Shape: One MCP Contract, Multiple Hosts

The product does not need to choose only one host, and it should not treat hosts as separate product lines.

QFerry should be built as a shared mail-governance core with one MCP tool contract:

```text
qferry-core
  - provider adapters
  - classification rules
  - safety model
  - operation preview/confirm
  - trace logging

qferry-mcp
  - local or remote MCP server
  - same tools for Codex, GPT Web custom MCP/App, and future hosts
  - optional connector metadata or widget UI later

qferry-cli
  - terminal workflow over the same core
  - fast local iteration without host reload

qferry-codex-bundle
  - Codex packaging metadata
  - skills for inbox triage and cleanup
  - local MCP bootstrap
```

This mirrors the Gmail pattern observed locally:

- The Codex Gmail plugin has skills for mailbox triage, search, summaries, label actions, replies, and forwarding.
- The plugin also declares a Gmail app connector id in `.app.json`.
- The Gmail skill treats send, archive, trash, label, and move operations as explicit actions, not implicit side effects.

For QFerry, this means the reusable contract should live below every host adapter. Codex and GPT Web should expose the same mailbox-governance verbs, safety model, and trace artifacts.

## Host Characteristics

### GPT Web / Custom MCP App

Good for end-user ChatGPT workflows.

Characteristics:

- Remote MCP server exposed over HTTPS, with `/mcp` endpoint.
- Connected in ChatGPT Developer Mode or submitted as an app later.
- Can expose tools and optional UI widgets.
- Must handle auth, safety, privacy, logging, and deployment as product concerns.
- Best target for a Gmail-like experience inside ChatGPT.

### Codex Plugin

Good for local operation, repository development, and supervised agent workflows.

Characteristics:

- Package of skills, metadata, optional app connector bindings, and MCP/tooling.
- Helps Codex use QFerry for repo work, local testing, and supervised mailbox operations.
- Uses the same backend and tool names as the GPT Web MCP host.
- Should stay a packaging/runtime adapter, not a separate behavior fork.

## Recommended Strategy

Build the shared backend and tool contract first, then wrap it.

Current baseline: the shared backend, MCP server, Codex bundle, and CLI all use Node/TypeScript with `pnpm`. Keep the existing Python QQ probe as a low-dependency diagnostic tool only.

Main reasons:

- OpenAI Apps SDK and MCP examples are Node-friendly.
- The strongest reference implementation is `leeguooooo/Mailbox`, which uses Node packages and `imapflow`.
- `Mailbox` contains provider-specific lessons for QQ/163-style IMAP search problems.
- TypeScript gives a better path to shared contracts across local/remote MCP hosts, Codex plugin packaging, and local test tools.

The trace-first tool baseline is now:

```text
1. local fixture adapter
2. QQ Mail capability probe and provider
3. preview-only cleanup planning
4. persisted ruleset governance and campaign preview
5. confirmed move/create-folder operations only through operationPlanId
6. trace artifacts for fixture, QQ read-only, and explicitly approved mutation e2e
```

Do not start with a widget UI. The first risk is provider capability and traceability, not layout.

## Gmail Reference Points

Gmail is useful as a product reference, not as a QQ Mail storage-model source.

Observed useful patterns:

- Native search-first workflow before reading bodies.
- Explicit triage buckets.
- Label-based cleanup.
- Explicit confirmation before send, archive, trash, label, or move.
- Clear distinction between system labels and user labels.

Important limitation:

```text
Gmail labels and archive semantics must not be assumed for QQ Mail.
```

Gmail archive is label-based. QQ Mail over IMAP is more likely to expose mailbox/folder and flag operations. QFerry should not pretend QQ Mail supports Gmail-style multi-label semantics unless a real probe proves it.

## QQ Mail Capability Boundary

QQ Mail cannot be treated as a generic IMAP server by assumption.

The current QQ Mail credential is for the user's primary mailbox and contains long-lived production mail. Treat it as high-risk production data.

Hard limits for normal real-account work:

- Read-only by default.
- Do not send mail.
- Do not delete mail.
- Do not move mail without a preview plan, explicit user approval, `confirm_cleanup_plan`, and `execute_cleanup`.
- Do not mark messages read/unread unless a future plan explicitly adds that workflow.
- Do not create folders without a preview plan, explicit user approval, `confirm_cleanup_plan`, and `execute_cleanup`.
- Do not scan the full mailbox.
- Keep metadata windows bounded.
- Default folder listing is allowed because it does not mutate state.
- Never print or commit `QQMAIL_KEY`.

Known from prior notes and public QQ Mail documentation:

- QQ Mail supports authorization codes for third-party clients.
- QQ Mail can expose POP3/IMAP/SMTP-style access to third-party clients.
- Common documented endpoints are expected to include `imap.qq.com` and `smtp.qq.com`.

Capability questions that remain product-significant:

- Are flags such as seen/unseen and flagged/starred available?
- Are QQ Mail web labels exposed over IMAP at all?
- Is there any stable server-side blacklist API, or does that require QQ Web automation?
- Should archive always mean moving to a configured folder for QQ Mail?

QFerry should keep durable product semantics at the ruleset/group layer:

- QFerry-local custom classification groups.
- Optional QQ folder targets after preview and confirmation.
- Read-only scan/classification.
- Preview-first cleanup plans.
- Confirmed mutations only through server-side operation ids.

## Custom Classification Rules

The user wants custom classification rules.

Initial design:

```text
classificationGroups:
  - id
  - name
  - description
  - priority
  - matchRules
  - actionPolicy
  - targetProviderLocation
```

`targetProviderLocation` is optional and provider-specific:

- For Gmail it can map to a label.
- For QQ Mail it may map to a folder if folder creation/move support is proven.
- If no provider target is safe, the group remains QFerry-local only.

## Trace And Test Evidence

Trace is a first-class product requirement.

Every run should emit structured records:

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
artifacts/e2e/<runId>/capability-snapshot.json
artifacts/e2e/<runId>/operation-plan.json
```

Minimum trace fields:

```text
runId
traceId
timestamp
provider
accountAlias
toolName
inputSummary
messageRefs
classificationGroup
confidence
evidenceFields
suggestedAction
operationId
dryRun
confirmedByUser
providerCapabilitySnapshotId
providerResult
durationMs
error
```

Privacy rule:

- Do not log full bodies or attachments by default.
- Log metadata, hashes, message ids, snippets, classification reasons, and action plans.
- Body logging must require an explicit debug mode and redaction policy.

## Open Questions

1. Whether QQ Mail web labels exist in a way that can be managed through IMAP.
2. Whether QQ Mail server-side blacklist can be managed by a verified API or only by Web automation.
3. Whether Gmail-like archive should be represented only as user-configured QQ folders.
4. Which MCP deployment mode should be documented first for new users: Codex local plugin, GPT Web custom MCP/App, or both with the same tool contract.

## Source Notes

- OpenAI Apps SDK quickstart: https://developers.openai.com/apps-sdk/quickstart
- OpenAI Apps SDK tool planning: https://developers.openai.com/apps-sdk/plan/tools
- OpenAI Apps SDK ChatGPT connection: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI Apps SDK MCP server guide: https://developers.openai.com/apps-sdk/build/mcp-server
- Local Gmail Codex plugin notes inspected under `C:\Users\Disas\.codex\plugins\cache\openai-curated\gmail\63976030`
- QQ Mail authorization-code help page: https://help.mail.qq.com/detail/106/985
- Code-level wheel audit: `docs/WHEEL_AUDIT.md`
