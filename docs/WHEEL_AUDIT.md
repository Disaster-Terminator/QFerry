# QFerry Wheel Audit

Date: 2026-05-12

Audit scope:

- `leeguooooo/Mailbox`
- `shuakami/mcp-mail`
- `neomody77/mcp-mail-organizer`
- `TimeCyber/email-mcp`
- `adamswanglin/email-mcp`
- `botoai/Auto-GPT-QQmail`

The reference repositories were shallow-cloned outside this repository under:

```text
G:\repository\qferry-wheel-research\
```

This was a static code audit. No reference project was run against the user's QQ Mail account.

## Short Verdict

QFerry should not fork any single reference project as the product base.

The strongest direction is:

```text
Use Mailbox as the main implementation reference for provider quirks, JSON contracts, dry-run mutation shape, and cache-aware mailbox operations.
Use adamswanglin/email-mcp as a reference for the first read-only MCP surface.
Use mcp-mail-organizer as a reference for atomic mailbox operations and preview UX, but do not copy its mutation behavior directly.
Use TimeCyber/email-mcp only for provider auto-detection tables.
Do not use Auto-GPT-QQmail as a base.
```

QFerry should keep its own core because the product needs a different contract:

- ChatGPT App / remote MCP first, not local stdio-only MCP.
- Codex plugin second, as a developer/operator wrapper.
- Custom classification groups.
- Provider capability snapshots before mutation.
- First-class trace artifacts.
- Strict no-body/no-attachment logging by default.
- Confirmed operations with server-side operation ids, not just a boolean flag.

## leeguooooo/Mailbox

Repository shape:

- Node monorepo.
- MIT license in core/cli packages and repository license.
- Main packages:
  - `packages/core`
  - `packages/cli`
  - `packages/shared`
  - `packages/workflows`
- Uses `imapflow`, `mailparser`, `nodemailer`, and `sql.js`.
- Includes CLI JSON contract docs and an MCP server wrapper.

Useful code paths:

- `packages/core/src/services/provider_defaults.js`
- `packages/core/src/services/imap.js`
- `packages/core/src/services/email.js`
- `packages/cli/src/mcp_server.js`
- `docs/CLI_JSON_CONTRACT.md`

Strong points:

- Has explicit QQ provider defaults.
- Uses `imapflow`, which is a stronger modern IMAP client than old callback-style `imap`.
- Supports local cache/sync, useful for large mailboxes.
- Provides structured JSON contracts for list/search/show/mark/delete/move/send.
- Mutating MCP tools default to dry-run and require `confirm=true`.
- Has tests and mock IMAP client infrastructure.
- Has provider-specific search handling. In `email.js`, it notes that QQ/163/126/sina/aliyun/outlook can have broken or misleading IMAP text search and falls back to client-side envelope filtering.

Risks and mismatches:

- It is CLI-first and local agent/skill-oriented, not ChatGPT App / remote MCP-first.
- Its dry-run confirmation is a boolean `confirm=true`, while QFerry should use server-side preview operation ids for safer repeatability.
- Its client-side fallback can fetch a lot of envelopes, with caps up to thousands. QFerry must default to much smaller supervised batches on the user's large QQ account.
- It already includes send/delete/permanent-style operations that QFerry should keep disabled until capability and safety rules are proven.

QFerry decision:

- Use it as the primary design reference.
- Do not fork it wholesale.
- Consider adapting its provider-defaults and search/folder lessons.
- Consider adopting `imapflow` for QFerry's real adapter instead of Python stdlib `imaplib` after the probe phase.

## shuakami/mcp-mail

Repository shape:

- TypeScript MCP server.
- Declares `ISC` license in `package.json`.
- Uses `@modelcontextprotocol/sdk`, `nodemailer`, `imap`, `mailparser`, `zod`.
- Large `src/tools/mail.ts` and `src/tools/mail-service.ts` files.

Useful code paths:

- `src/tools/mail.ts`
- `src/tools/mail-service.ts`

Strong points:

- Broad function coverage:
  - send
  - bulk send
  - search
  - detail fetch
  - folders
  - delete
  - move
  - mark read/unread
  - contacts
  - attachments
- Contains QQ-specific comments/workarounds around message detail fallback.

Risks and mismatches:

- It is broad but not trace-first.
- Many tools perform direct mutations without QFerry-style operation ids.
- Console logging is noisy and can interfere with MCP stdio unless carefully routed.
- The project is not focused on ChatGPT App metadata, remote MCP, auth, privacy, or audit trails.
- Uses older callback-style `imap`.

QFerry decision:

- Mine for feature inventory and QQ edge-case anecdotes.
- Do not use as implementation base.
- Do not inherit its broad tool surface for MVP.

## neomody77/mcp-mail-organizer

Repository shape:

- TypeScript MCP server.
- MIT license.
- Uses `@modelcontextprotocol/sdk`, `imap`, `mailparser`, `nodemailer`, `zod`.
- Atomic mail tools in `src/tools/mail-tools.ts`.
- Mail behavior in `src/services/mail-service.ts`.

Useful code paths:

- `src/tools/mail-tools.ts`
- `src/services/mail-service.ts`

Strong points:

- Tool names match mailbox organization well:
  - `list_mailboxes`
  - `create_mailbox`
  - `search_emails`
  - `move_emails`
  - `delete_emails`
  - `mark_seen`
  - `add_flags`
  - `remove_flags`
  - `send_mail`
- README explicitly describes preview mode for destructive operations.
- Move has `imap.move` with copy/delete fallback.
- It blocks mailbox deletion if the mailbox is not empty.

Risks and mismatches:

- `move_emails` appears to mutate directly; preview coverage is not uniformly applied to all destructive operations.
- Copy-delete fallback plus expunge is high risk for a production mailbox unless heavily guarded.
- TLS options include `rejectUnauthorized: false`, which should not be QFerry default.
- Uses older callback-style `imap`.
- Does not implement QFerry's trace artifacts or provider capability snapshot contract.

QFerry decision:

- Use as a reference for atomic operation vocabulary and preview wording.
- Do not copy mutation implementation without a stricter operation-plan layer.
- Treat folder creation and move fallback as capabilities to probe, not features to assume.

## TimeCyber/email-mcp

Repository shape:

- Single-file JavaScript MCP server.
- MIT license.
- Uses older MCP SDK version and `imap`, `nodemailer`, `poplib`.

Useful code paths:

- `index.js`
- `CONFIG_GUIDE.md`

Strong points:

- Provider auto-detection table includes QQ and Tencent enterprise mail.
- Documents QQ host/port defaults.
- Good source for provider setup UX and basic config examples.

Risks and mismatches:

- Very broad "universal email" shape.
- Main product emphasis includes sending.
- Not designed for careful mailbox governance, classification, or traceable cleanup.
- Less suitable as a robust adapter base.

QFerry decision:

- Use only for provider detection/config table inspiration.
- Do not use as QFerry core.

## adamswanglin/email-mcp

Repository shape:

- TypeScript MCP server.
- MIT license.
- Uses `imap`, `mailparser`, and `mcps-logger`.
- Read-oriented API.

Useful code paths:

- `src/server.ts`
- `src/email-service.ts`
- `src/types.ts`

Strong points:

- Good minimal read-only shape:
  - `search_emails`
  - `list_mailboxes`
  - `test_connection`
  - `get_email_contents_by_uids`
  - `get_current_date`
- Groups content fetch by `(uid, folder)`, which is a useful design for QQ where UID alone is not enough.
- Uses `mcps-logger`, which is a useful reminder that MCP stdio logging must be handled carefully.

Risks and mismatches:

- Text is mojibake in checked-out files, which increases maintenance friction.
- Search defaults can span all folders and fetch body content; QFerry needs lower default limits.
- No cleanup, classification, preview/confirm, or audit model.
- Uses older callback-style `imap`.

QFerry decision:

- Use as the closest read-only MVP reference.
- Keep QFerry's first ChatGPT/Codex tool surface similarly small before adding mutations.

## botoai/Auto-GPT-QQmail

Repository shape:

- Python Auto-GPT plugin template.
- MIT license metadata.
- README and package metadata still describe a generic Auto-GPT plugin template.

Useful code paths:

- None for QFerry implementation.

QFerry decision:

- Treat as non-actionable historical signal only.
- Do not use as base or reference implementation.

## Cross-Repository Findings

### 1. QQ Mail Search Needs Special Treatment

`Mailbox` explicitly warns that QQ and similar providers may ignore or mishandle IMAP text search. This is more valuable than generic documentation.

QFerry should:

- Start with envelope/header metadata scans.
- Avoid assuming `BODY` or `TEXT` search works.
- Keep body reads opt-in and tightly limited.
- Use custom classification rules over metadata first.
- Add provider-specific fallback logic after capability probes.

### 2. UID Must Be Paired With Folder

Multiple projects model operations as `(folder, uid)`.

QFerry should never use a bare UID as a stable global message id for QQ Mail. Use a provider reference like:

```json
{
  "provider": "qqmail",
  "accountAlias": "masked",
  "folder": "INBOX",
  "uid": 12345,
  "uidValidity": "if available"
}
```

### 3. Folder Semantics Beat Label Semantics For QQ Mail

The audited projects all treat QQ-style IMAP storage as folders/mailboxes, not Gmail-style multi-label storage.

QFerry should:

- Keep custom classification groups in QFerry-local state.
- Map groups to QQ folders only after folder capability is probed.
- Avoid promising Gmail-like multi-label behavior on QQ.

### 4. Preview Is Common But Not Enough

Several projects use preview/dry-run language. QFerry needs a stricter version:

```text
plan_cleanup -> operationPlanId -> preview artifact -> explicit confirm -> execute
```

The confirmation should reference a saved operation plan, not a free-form repeat of arguments. This makes tests traceable and prevents accidental broad operations.

### 5. Logging Needs A Separate Product Contract

Reference projects mostly rely on console logs or debug logs. QFerry needs structured trace artifacts:

- JSONL run log.
- Capability snapshot.
- Operation plan JSON.
- Human-readable summary.
- No full body/attachment logging by default.

### 6. Mutation Must Stay Disabled Until Capability Probe Proves It

The first QFerry probe already showed QQ IMAP capabilities including `MOVE` and `UIDPLUS`, but this only proves advertised server support. It does not prove safe product behavior.

Before enabling real operations, QFerry still needs a test mailbox or a sacrificial test message to prove:

- move from INBOX to target folder
- move back
- mark read/unread
- create folder if we want auto-created classification folders
- no unexpected expunge/delete behavior

Do not run those tests on the user's primary mailbox without an explicit target test message and approval.

## Recommended Implementation Direction

Use a Node/TypeScript core for the real implementation, not Python.

Reason:

- OpenAI Apps SDK and MCP examples are Node-friendly.
- The strongest email references are Node/TypeScript.
- `imapflow` from `Mailbox` is a better foundation than Python stdlib `imaplib` for long-term adapter work.
- Codex plugin packaging can wrap the same Node backend later.

Keep the existing Python probe as a low-dependency diagnostic tool only.

Recommended next slice:

```text
1. Add docs/ARCHITECTURE.md with shared-core + ChatGPT App + Codex plugin wrappers.
2. Create a TypeScript package skeleton for qferry-core and qferry-server.
3. Implement a fixture provider first.
4. Implement trace writer and operation-plan model before real mutations.
5. Port QQ read-only adapter using imapflow with a hard default limit.
6. Add provider capability probe command in TypeScript.
7. Only then expose MCP tools.
```

Initial tool surface should be:

```text
test_connection
list_mailboxes
scan_mailbox_metadata
search
fetch
classify_messages_preview
plan_cleanup
```

Mutation tools should wait:

```text
move_messages_confirm
mark_messages_confirm
create_mailbox_confirm
delete_messages_confirm
send_mail
```

`delete_messages_confirm` and `send_mail` should not be MVP tools for the user's primary requirement.
