# QFerry Research Notes

Date: 2026-05-12

## Current Goal

QFerry should prioritize mailbox organization, classification, detection, cleanup, and archive workflows for existing QQ Mail messages. Reply drafting is a secondary feature, not the first-class product goal.

The core user flow is:

```text
scan mailbox -> classify messages -> explain why -> propose cleanup/archive plan -> preview changes -> user confirms -> execute -> write trace artifacts
```

Every testable run must leave evidence that can be reviewed after the fact. The user should not have to describe what happened manually.

## Product Shape: Codex Plugin And ChatGPT App

The product does not need to choose only one surface.

QFerry can be built as a shared mail-governance core with two wrappers:

```text
qferry-core
  - provider adapters
  - classification rules
  - safety model
  - operation preview/confirm
  - trace logging

qferry-chatgpt-app
  - remote MCP over HTTPS
  - ChatGPT Apps / Connectors setup
  - optional widget UI later

qferry-codex-plugin
  - Codex plugin metadata
  - skills for inbox triage and cleanup
  - app/connector binding when available
```

This mirrors the Gmail pattern observed locally:

- The Codex Gmail plugin has skills for mailbox triage, search, summaries, label actions, replies, and forwarding.
- The plugin also declares a Gmail app connector id in `.app.json`.
- The Gmail skill treats send, archive, trash, label, and move operations as explicit actions, not implicit side effects.

For QFerry, this means the reusable contract should live below both wrappers. The ChatGPT App is the public/product-facing shape; the Codex plugin is a developer/operator shape that helps us test, inspect, and use the same mailbox-governance capabilities inside Codex.

## Difference Between The Two Surfaces

### ChatGPT App / GPT App

Best for the end-user product.

Characteristics:

- Remote MCP server exposed over HTTPS, with `/mcp` endpoint.
- Connected in ChatGPT Developer Mode or submitted as an app later.
- Can expose tools and optional UI widgets.
- Must handle auth, safety, privacy, logging, and deployment as product concerns.
- Best target for a Gmail-like experience inside ChatGPT.

### Codex Plugin

Best for development, local operation, and agent workflows.

Characteristics:

- Package of skills, metadata, optional app connector bindings, and MCP/tooling.
- Helps Codex use QFerry for repo work, local testing, and supervised mailbox operations.
- Can share the same backend and tool names as the ChatGPT App.
- Should not become the only product surface if the goal is ChatGPT user experience.

## Recommended Strategy

Build the shared backend and tool contract first, then wrap it.

After code-level wheel audit, the recommended implementation language for the real core is Node/TypeScript. Keep the existing Python QQ probe as a low-dependency diagnostic tool only.

Main reasons:

- OpenAI Apps SDK and MCP examples are Node-friendly.
- The strongest reference implementation is `leeguooooo/Mailbox`, which uses Node packages and `imapflow`.
- `Mailbox` contains provider-specific lessons for QQ/163-style IMAP search problems.
- TypeScript gives a better path to shared contracts across remote MCP, Codex plugin packaging, and local test tools.

Phase 1 should be tool-only and trace-first:

```text
1. local fixture adapter
2. Gmail reference adapter for product-shape comparison
3. QQ Mail capability probe
4. QQ Mail read-only adapter
5. preview-only cleanup planning
6. confirmed move/archive/mark operations only after probe proves support
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

The current QQ Mail credential is for the user's primary mailbox and reportedly contains more than 2,000 messages. Treat it as high-risk production data.

Hard limits for the initial probe:

- Read-only only.
- Do not send mail.
- Do not delete mail.
- Do not move mail.
- Do not mark messages read/unread.
- Do not create or delete folders.
- Do not scan the full mailbox.
- Default metadata sample limit: 10 messages.
- Default folder listing is allowed because it does not mutate state.
- Never print or commit `QQMAIL_KEY`.

Known from prior notes and public QQ Mail documentation:

- QQ Mail supports authorization codes for third-party clients.
- QQ Mail can expose POP3/IMAP/SMTP-style access to third-party clients.
- Common documented endpoints are expected to include `imap.qq.com` and `smtp.qq.com`.

What must be probed before implementing real operations:

- Can we list all mailboxes/folders?
- Are custom folders visible over IMAP?
- Can we create a folder/mailbox over IMAP?
- Can we move messages between folders?
- Does the server support `MOVE`, or must we use copy-plus-delete semantics?
- Are flags such as seen/unseen and flagged/starred available?
- Are QQ Mail web labels exposed over IMAP at all?
- Is there any stable archive folder, or should archive mean moving to a configured folder?

Until these are proven, QFerry should support:

- QFerry-local custom classification groups.
- Read-only scan/classification.
- Preview-only cleanup plans.

Real mailbox mutations should be disabled by default until the capability probe records support.

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
2. Whether QQ Mail custom folders can be created and moved into reliably through IMAP.
3. Whether Gmail-like archive can be represented naturally in QQ Mail.
4. Whether the first public product should expose only ChatGPT App, or ship Codex plugin at the same time as a developer companion.

## Source Notes

- OpenAI Apps SDK quickstart: https://developers.openai.com/apps-sdk/quickstart
- OpenAI Apps SDK tool planning: https://developers.openai.com/apps-sdk/plan/tools
- OpenAI Apps SDK ChatGPT connection: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI Apps SDK MCP server guide: https://developers.openai.com/apps-sdk/build/mcp-server
- Local Gmail Codex plugin notes inspected under `C:\Users\Disas\.codex\plugins\cache\openai-curated\gmail\63976030`
- QQ Mail authorization-code help page: https://help.mail.qq.com/detail/106/985
- Code-level wheel audit: `docs/WHEEL_AUDIT.md`
