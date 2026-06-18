# QFerry CLI Design

## Goal

Add a repo-local QFerry CLI so common provider checks, mailbox discovery, governance previews, and local ruleset patch validation can run from the terminal without waiting for Codex MCP plugin reloads.

## Architecture

The CLI is a thin adapter over `@qferry/core`. Provider creation moves into core so MCP and CLI share the same runtime config, fixture provider, QQ provider, and unavailable-provider behavior. The CLI does not own classification logic, mailbox mutation policy, or operation-plan confirmation.

## Commands

- `status`
- `list-mailboxes`
- `mailbox-summary --folder <folder>`
- `high-yield --folder <folder> --page-size <n> --max-pages <n> ...`
- `ruleset-preview --input <json>`
- `ruleset-campaign-preview --input <json>`
- `apply-ruleset-patch --rules-file <path> --patch-file <json> [--apply] [--include-rendered-draft]`

Complex preview commands accept `--input` JSON so the CLI does not grow a second schema language. Common high-yield flags are kept because that is the hot iteration path.

## Safety

The first CLI version is read-only or local-file-only. It can create preview operation plans and apply a local `qferry.rules.json` patch when explicitly passed `--apply`, but it does not confirm or execute mailbox mutations. Real mailbox runs keep `QQMAIL_KEY` in environment/config loading only and never print it.

## Audit

Commands that scan or produce governance previews create `logs/runs/<runId>.jsonl` and `artifacts/e2e/<runId>/summary.md`. `--run-id` is accepted; otherwise the CLI generates one.

## Testing

Tests exercise fixture mode through the CLI runner and verify compact output plus audit artifacts. Full repo `pnpm run check` remains the release gate.
