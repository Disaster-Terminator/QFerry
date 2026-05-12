# QFerry Architecture

Date: 2026-05-12

## Product Goal

QFerry is a mailbox-governance product for QQ Mail, using Gmail as the product benchmark but not copying Gmail's storage model.

Primary workflow:

```text
scan mailbox metadata -> classify -> explain -> plan cleanup/archive -> preview -> confirm -> execute -> trace
```

Reply drafting is not the first-class goal. Sending and deletion are outside the MVP.

## Surfaces

QFerry has one shared core and two wrappers.

```text
packages/core
  trace writer
  operation plans
  provider interfaces
  fixture provider
  future QQ/Gmail providers

apps/chatgpt-app
  remote MCP server over HTTPS
  ChatGPT App / connector metadata
  optional widget later

plugins/codex
  Codex plugin metadata
  QFerry skills
  developer/operator workflows
```

The wrappers must not own mailbox logic. They call `packages/core`.

## Storage Model

QFerry exposes custom classification groups. Provider-specific storage targets are optional.

```text
classification group
  -> QFerry-local group by default
  -> Gmail label when using Gmail
  -> QQ folder only after QQ folder/move capability is proven
```

QQ Mail must be treated as an IMAP folder/mailbox provider until probes prove otherwise. Gmail labels are a product reference, not a QQ implementation assumption.

## Provider Contract

Providers should expose read-only capabilities first:

```ts
listMailboxes(): Promise<MailboxInfo[]>
scanMailboxMetadata(input): Promise<MessageSummary[]>
fetchMessage(input): Promise<MessageDetail>
getCapabilitySnapshot(): Promise<ProviderCapabilitySnapshot>
```

Mutation capabilities stay behind operation plans:

```ts
planCleanup(input): Promise<OperationPlan>
confirmOperation(operationPlanId): Promise<OperationResult>
```

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

Initial implementation must enforce:

- Fixture provider only for mutation tests.
- QQ provider read-only until mutation probes are explicitly approved.
- No full mailbox scans by default.
- No delete/send tools in MVP.
- Move/mark/create-folder must require a saved operation plan id.
- Operation confirmation must not accept arbitrary fresh arguments.

## Implementation Stack

Use Node/TypeScript for the core.

Reasons:

- OpenAI Apps SDK and MCP examples are Node-friendly.
- The strongest reference wheel, `Mailbox`, uses Node and `imapflow`.
- TypeScript contracts can be shared by ChatGPT App and Codex plugin wrappers.

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

## MVP Boundary

Allowed now:

- Architecture docs.
- Trace writer.
- Operation-plan model.
- Fixture provider.
- Unit tests.

Not allowed in this slice:

- Real QQ mutation.
- ChatGPT remote MCP server.
- Codex plugin packaging.
- Gmail mailbox mutation.
- Full mailbox scan.
