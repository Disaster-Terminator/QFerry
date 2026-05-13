# Retinue E2E Notes

## 2026-05-12 QFerry plugin uninstall investigation

Context:

- Retinue was used as an OpenCode-backed, low-cost read-only subagent pool while the main Codex thread handled decisions and implementation.
- Tasks were scoped to plugin install/cache investigation and cross-checking supervisor/Retinue packaging patterns.

Findings:

- A Retinue read-only job reported `stalled` after repeated tool-call rounds without a completed assistant message.
- Another read-only job was still `running` after the wait timeout and did not return a result in time for the main critical path.
- The useful completed comparison came from the supervisor-side packaging check, but local installed Retinue cache remained the source of truth for the bootstrap pattern.

Recommendation:

- Retinue should surface stalled/running jobs as first-class workflow events with concise partial diagnostics, so Codex can decide whether to wait, close, or inspect logs without losing the critical path.
- For read-only exploration jobs, prefer a hard max wall-clock and return partial observations when available.
- Keep write responsibility in the main agent or explicitly bounded worker jobs until OpenCode result quality and termination behavior are more predictable.

## 2026-05-13 QFerry concurrent pressure check

Context:

- Retinue was used with the installed OpenCode backend while QFerry real QQ Mail mutation e2e work continued on the main thread.
- The test intentionally filled the visible `maxAgents=3` pool with two repository review jobs and one small deterministic read-only job.

Observed jobs:

- `job_dc14b3f1-1816-4d8d-b17f-1d567b80cc34` completed and returned a concise read-only summary of `package.json` and `AGENTS.md`.
- `job_e02d0f44-0245-4211-b6cd-48108bafab80` remained running during the critical path and produced wait-timeout diagnostics from OpenCode.
- `job_84b42f37-0fec-4946-8a76-5bb835cc2714` was later reported as `stalled` after repeated tool-call assistant rounds with no completed assistant text.

Findings:

- Retinue accepted three concurrent jobs and `retinue_list_agents` reported all three, so spawn/list pressure at the configured pool size worked.
- The small deterministic job completed successfully under concurrency.
- Long-running OpenCode exploration jobs can still stall, but the stalled status is now explicit and includes enough diagnostic text for the main agent to avoid waiting indefinitely.

Recommendation:

- Keep Retinue in the QFerry workflow for low-cost read-only exploration and pressure coverage.
- Prefer short, concrete prompts when using OpenCode through Retinue; split broad reviews into smaller checks.
- Treat `running` and `stalled` as useful test outcomes, record the job ids, and keep QFerry implementation decisions in the main Codex thread.
