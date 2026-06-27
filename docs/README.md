# QFerry Documentation

This directory is the maintainer-facing map for QFerry. End-user install and basic usage stay in the root [README](../README.md).

## Start Here

- [Architecture](ARCHITECTURE.md): product boundary, provider contract, trace contract, safety model, and current implementation stack.
- [CLI](CLI.md): local hot-iteration workflow for status, search, campaign preview, ruleset patching, and bounded execution experiments.
- [Codex Plugin Acceptance](CODEX_PLUGIN_ACCEPTANCE.md): Codex plugin install path, plugin-local MCP runtime packaging, safety acceptance, and CI gates.
- [GPT Web Cloud Testing Handoff](GPTWEB_CLOUD_TESTING_HANDOFF.md): cloud deployment and GPT Web connector smoke workflow.
- [Maintainer Audit](MAINTAINER_AUDIT.md): current repository review, risks, and follow-up priorities.

## Reference Notes

- [Fixture E2E](FIXTURE_E2E.md): fixture-provider e2e contract.
- [Research Notes](RESEARCH_NOTES.md): early product and provider research.
- [Wheel Audit](WHEEL_AUDIT.md): reference-project audit and why QFerry keeps its own core.
- [Retinue E2E Notes](RETINUE_E2E_NOTES.md): historical low-cost agent exploration notes.

## Maintenance Rules

- Keep the root README short enough to be the project landing page.
- Put host-specific operational detail in a host-specific doc instead of duplicating it across README and skills.
- When `package.json` scripts, CI, or plugin packaging change, update `CODEX_PLUGIN_ACCEPTANCE.md` in the same patch.
- Do not document secrets, full mailbox listings, raw message bodies, or local-only tunnel credentials.
