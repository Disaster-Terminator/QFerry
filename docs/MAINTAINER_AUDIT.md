# QFerry Maintainer Audit

Date: 2026-06-27

## Scope

This audit reviewed the repository shape, docs, CI gate, plugin packaging, MCP server surface, CLI entrypoint, core tools, test layout, and GitHub repository metadata.

## Current Shape

QFerry is organized around one shared mailbox-governance core:

```text
packages/core         shared provider contracts, rules, operation plans, trace, governance workflows
apps/chatgpt-app     MCP server, ChatGPT App widget resource, host-specific tool registration
apps/cli             local CLI over the same core
plugins/qferry       Codex plugin package, skill, bootstrap, bundled MCP runtime
scripts              generated artifact checks, plugin verification, e2e and cache sync
docs                 architecture, operations, acceptance, research, and handoff docs
```

The product boundary is coherent: Codex plugin, GPT Web/App, and CLI are host adapters over the same MCP/core behavior rather than independent products.

## What Looks Healthy

- Real mailbox mutation is still preview-first and operation-plan based.
- QQ Mail secrets are kept out of committed config; `.env*`, logs, and e2e artifacts are ignored.
- The plugin bundle is self-contained through `plugins/qferry/mcp-bootstrap.mjs` and `plugins/qferry/dist/mcp.cjs`.
- CI runs source tests, typecheck, generated artifact check, plugin package verification, and fixture plugin e2e.
- The CLI reuses `@qferry/core` instead of duplicating mailbox logic.
- The ChatGPT sensitive-cleanup UI path is explicitly separated from model-visible high-sensitivity execution.

## Risks And Follow-Ups

### Large Core Files

`packages/core/src/tools/mail-tools.ts` and `apps/chatgpt-app/src/mcp-server.ts` are now the largest maintenance risks. They are functional, but they mix several concerns:

- ruleset governance
- discovery helpers
- campaign workflow
- execution reconciliation
- MCP tool registration
- sensitive UI hydration and execution policy

Do not split them casually during feature work. The safer path is to extract one cohesive boundary at a time, with tests already covering the extracted behavior.

Recommended extraction order:

1. `mail-tools` campaign/ruleset reporting helpers.
2. MCP operation-plan store and sensitive execution policy helpers.
3. ChatGPT widget HTML/state hydration into a small UI template module.

### Generated Plugin Artifact Drift

The generated plugin runtime can differ by platform in bundled third-party dependency output. The current check keeps local generated artifacts strict, while GitHub Actions continues to runtime-verify the platform-generated bundle.

Related files:

- `scripts/sync-qferry-plugin-runtime.mjs`
- `scripts/check-generated-plugin-runtime.mjs`
- `scripts/verify-qferry-plugin.mjs`
- `.github/workflows/ci.yml`

If this becomes noisy again, prefer making the bundle generation more deterministic over weakening runtime verification.

### Documentation Boundaries

Before this audit, README, plugin acceptance, and architecture docs repeated several workflow details. The current doc map should be kept as the source of truth:

- root README: public landing page and basic install
- `docs/README.md`: maintainer index
- `docs/CODEX_PLUGIN_ACCEPTANCE.md`: plugin and CI acceptance
- `docs/GPTWEB_CLOUD_TESTING_HANDOFF.md`: cloud GPT Web loop
- `docs/ARCHITECTURE.md`: product and safety model

## Verification Checklist For Future Changes

For docs-only changes:

```bash
pnpm run check:generated
pnpm run verify:qferry-plugin
```

For source, plugin, MCP, or packaged runtime changes:

```bash
pnpm run check
pnpm run qferry:e2e:plugin-qq-readonly
pnpm run dev:sync-plugin-cache:all -- --apply
```

The QQ read-only e2e requires local authorization and must keep `mutationsAttempted: 0`.
