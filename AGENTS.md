@C:\Users\Disas\.codex\RTK.md

# QFerry Project Instructions

## Tooling

- Use `pnpm` for Node/TypeScript workflows.
- Use `uv` for Python workflows.

## Plugin Reload Discipline

After changing code or packaged plugin behavior, do not stop at source tests. Compile first, then sync the installed QFerry plugin cache yourself so the next Codex restart/new thread can consume the new bundle without uninstalling and reinstalling the plugin.

Default local flow:

```bash
pnpm run check
pnpm run qferry:e2e:plugin-fixture
pnpm run dev:sync-plugin-cache:all -- --apply
```

Use `dev:sync-plugin-cache:all` only for QFerry. It syncs the installed QFerry cache for Windows and, when detectable, WSL. It does not install QFerry, uninstall QFerry, update marketplaces, or touch other plugin projects.

Existing Codex threads are not a plugin reload proof. After cache sync, the user may still need to restart the relevant Codex host and open a new thread.

For docs-only or test-only edits that do not need the installed plugin bundle, cache sync is optional. For any change under `packages/`, `apps/chatgpt-app/src/`, `plugins/qferry/`, or packaged runtime scripts, run the reload flow unless blocked and state the blocker.

## Real Mailbox Safety

QFerry is read-only and preview-first for real QQ Mail unless the user explicitly authorizes a specific mutation. Real QQ e2e must keep `mutationsAttempted: 0`, use bounded metadata reads, and leave trace artifacts under `logs/runs/` plus summaries under `artifacts/e2e/`.

Never commit or print `QQMAIL_KEY`. It belongs in the environment only, not in config files, docs, trace artifacts, summaries, or logs.
