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
