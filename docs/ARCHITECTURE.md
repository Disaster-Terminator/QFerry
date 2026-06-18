# QFerry Architecture

Date: 2026-05-12

## Product Goal

QFerry is a mailbox-governance product for QQ Mail, using Gmail as the product benchmark but not copying Gmail's storage model.

Primary workflow:

```text
scan mailbox metadata -> classify -> explain -> plan cleanup/archive -> preview -> confirm -> execute -> trace
```

Reply drafting is not the first-class goal. Sending and deletion are outside the current safe product surface.

Current governance work should optimize for framework efficiency instead of conversation-level manual triage. The primary path is:

```text
load user ruleset -> scan bounded mailbox window -> produce campaign report and grouped plans -> user approves plans -> execute with reconciliation traces
```

`classification_map`, `classification_sweep`, and `bulk_governance_preview` remain discovery helpers. They are not the durable Gmail-like workflow. Durable governance should be expressed as user-defined rules and folder targets so one preview can cover hundreds of messages without forcing the agent to read or summarize every candidate.

## MCP Surface And Hosts

QFerry has one shared core and one durable MCP tool contract. Codex plugin packaging, GPT Web custom MCP/App wiring, and CLI automation are host adapters around the same mailbox-governance core; they should not be modeled as separate products.

```text
packages/core
  trace writer
  operation plans
  provider interfaces
  fixture provider
  future QQ/Gmail providers

apps/chatgpt-app
  MCP server entrypoint
  optional ChatGPT/GPT Web connector metadata
  optional widget later

plugins/qferry
  Codex plugin packaging metadata
  QFerry skills
  local MCP bootstrap

apps/cli
  terminal entrypoint for hot iteration and scripted e2e
```

Host adapters must not own mailbox logic. They call `packages/core` and expose the same preview/confirm/execute safety model.

## Codex Plugin Packaging Reference

QFerry should follow the proven plugin packaging pattern from `G:\repository\supervisor` for the Codex-hosted MCP bundle.

Applicable practices:

- Keep a plugin directory with `.codex-plugin/plugin.json`, `.mcp.json`, skills, README, and plugin-local `dist/`.
- Make marketplace/plugin installs self-contained: `.mcp.json` should start runtime from plugin-local `./dist/...`, not from the source tree.
- Build root runtime first, then sync/bundle the runtime into the plugin directory.
- Add a package verifier based on `pnpm pack --dry-run --json` that fails if required docs, plugin manifests, skill files, or `dist/` runtime files are missing.
- Do not rely on the user's local source checkout for a marketplace-installed plugin.

Codex plugin packaging is the easiest local deployment path today, but it is not a separate product boundary. GPT Web / custom App integration should reuse the same MCP server and tool contract rather than forking behavior.

## Storage Model

QFerry exposes custom classification groups. Provider-specific storage targets are optional.

```text
classification group
  -> QFerry-local group by default
  -> Gmail label when using Gmail
  -> QQ folder only after QQ folder/move capability is proven
```

QQ Mail must be treated as an IMAP folder/mailbox provider until probes prove otherwise. Gmail labels are a product reference, not a QQ implementation assumption.

Ruleset governance previews include a compact campaign report:

- `scannedMessages`: metadata messages inspected in the bounded window.
- `plannedMessages`: messages selected into operation plans.
- `unplannedMessages`: messages left outside the generated plans.
- `coverageBasis`: always `scanned_window`; these metrics describe only the bounded metadata window inspected by this preview, not the whole mailbox unless the preview window covered the whole mailbox.
- `coverageRatio`: `plannedMessages / scannedMessages`, rounded for human review.
- `topUnplannedDomains`: top sender domains among messages not selected into any plan, capped for compact agent review.
- `topUnplannedSenders`: top concrete senders among messages not selected into any plan, including a few subject samples, capped for compact rule-expansion review.
- `truncatedGroups`: groups where the rule matched more messages than `maxMessageRefsPerGroup` allowed into the plan.
- `nextAction`: `confirm_plans` when the plan set covers the window cleanly, `review_rules` when more rules or a wider preview are needed, and `no_action` when no executable plan exists.

This report is the agent-facing control surface for large mailbox治理. `nextAction` is deterministic framework output, not model-generated judgment. If `nextAction` is `review_rules`, the next step is to improve the ruleset or increase the preview window, not to manually inspect every UID in the conversation.

## Provider Contract

Providers should expose read-only capabilities first:

```ts
listMailboxes(): Promise<MailboxInfo[]>
scanMailboxMetadata(input): Promise<MessageSummary[]>
fetchMessage(input): Promise<MessageDetail>
getCapabilitySnapshot(): Promise<ProviderCapabilitySnapshot>
```

Mutation capabilities stay behind server-side operation plans:

```ts
planCleanup(input): Promise<OperationPlan>
confirmCleanupPlan(operationPlanId): Promise<ConfirmedOperationPlan>
executeCleanup(operationPlanId): Promise<OperationResult>
```

`confirmCleanupPlan` and `executeCleanup` are intentionally separate. Confirmation records that the user approved one specific preview plan generated by the current MCP server instance; execution consumes that confirmed `operationPlanId` exactly once. Clients must not send a fabricated `status: "confirmed"` plan object.

For QQ Mail, every message reference must include at least:

```json
{
  "provider": "qqmail",
  "accountAlias": "masked",
  "folder": "INBOX",
  "uid": "12345"
}
```

A bare UID is not enough.

## Trace Contract

Trace is a product requirement, not debug output.

Every run writes:

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
artifacts/e2e/<runId>/capability-snapshot.json
artifacts/e2e/<runId>/operation-plan.json
```

Default privacy rules:

- Do not log full body.
- Do not log attachments.
- Do not log auth secrets.
- Log message references, sender/subject hashes or snippets only when explicitly allowed by the caller.
- Log operation plans and results.

## Safety Rules

Current implementation must enforce:

- Preview-first behavior for all real QQ operations.
- Real QQ mutation only after explicit user approval, `confirm_cleanup_plan`, and `execute_cleanup`.
- No full mailbox scans by default.
- No delete/send tools in the current safe product surface.
- Move/mark/create-folder must require a saved operation plan id.
- Operation confirmation must not accept arbitrary fresh arguments.
- A confirmed operation plan id is single-use; retrying the same id after an execute attempt must fail.

## Implementation Stack

Use Node/TypeScript for the core.

Reasons:

- OpenAI Apps SDK and MCP examples are Node-friendly.
- The strongest reference wheel, `Mailbox`, uses Node and `imapflow`.
- TypeScript contracts can be shared by MCP host adapters and the CLI.

The existing Python probe remains as a low-dependency diagnostic tool.

## Initial File Layout

```text
package.json
tsconfig.json
packages/
  core/
    package.json
    src/
      index.ts
      trace.ts
      operation-plan.ts
      providers/
        types.ts
        fixture-provider.ts
    test/
      trace.test.ts
      operation-plan.test.ts
      fixture-provider.test.ts
```

## Current Product Boundary

Implemented now:

- Shared TypeScript core with provider contracts, trace writer, operation-plan model, ruleset governance, campaign preview, and confirmed execution primitives.
- Fixture and QQ Mail providers.
- MCP server entrypoint used by Codex plugin packaging and compatible MCP hosts.
- Codex plugin bundle with plugin-local bootstrap and skills.
- CLI for local hot iteration and scripted e2e.
- Fixture and QQ read-only e2e artifacts.

Still outside the safe default path:

- Real QQ mutation without a preview plan, explicit user approval, `confirm_cleanup_plan`, and `execute_cleanup`.
- Server-side QQ blacklist changes until a QQ Web/API path is verified.
- Delete/send tools for the user's primary mailbox.
- Full mailbox scans by default.
- Gmail mailbox mutation; Gmail remains a product reference, not the current provider target.

## Blocklist Boundary

QFerry has two separate blocklist layers:

- QFerry rule-layer blocklist: deterministic metadata rules such as `fromIncludes: "known-junk.example"` that classify matching messages into cleanup/archive groups and make them eligible for preview or confirmed move workflows.
- QQ Mail server-side blacklist: QQ Mail exposes blacklist/anti-spam settings in its Web/App settings surface, but QFerry has not found or verified a public IMAP/SMTP/API endpoint for adding senders or domains to that server-side blacklist.

Current implementation supports the rule-layer blocklist and IMAP move-to-Junk cleanup. Server-side "do not enter mailbox" blocking is a separate capability that needs QQ Web automation or a verified private endpoint before QFerry can claim support.

Until that is implemented, pressure tests against known junk sources should:

```text
scan bounded metadata -> match blocklist rule -> preview plan -> confirmed move to Junk -> trace
```

They must not claim that the sender has been added to QQ Mail's server-side blacklist.
