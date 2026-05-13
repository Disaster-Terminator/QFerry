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

## 2026-05-13 QFerry short-task pressure check after retry fix

Context:

- Retinue was used again after the QFerry QQ IMAP retry fix and plugin reload.
- The run spawned three short, concrete read-only jobs at the configured `maxAgents=3` pool size.

Observed jobs:

- `job_53269ef3-2547-4ed3-ad02-53cb5b5f2aad` completed and identified `pnpm run qferry:e2e:plugin-qq-move-spam` as the real QQ spam move e2e command.
- `job_b40df655-541c-46e5-bc81-72accccbe571` completed and identified `retries transient QQ IMAP connection failures once` as the retry test.
- `job_7b58cae7-c1e3-4260-a18a-38aea272da49` completed and summarized the previous Retinue pressure findings.

Findings:

- All three short read-only jobs completed under concurrency.
- Short, narrow prompts are reliable enough for QFerry cross-checks.
- Broad repository-review jobs remain more likely to stall, so the QFerry workflow should keep Retinue tasks small and evidence-oriented.

## 2026-05-13 Codex plugin batch preview planning audit

Context:

- Retinue was used for two concurrent read-only reviews while the main Codex thread implemented the batch cleanup preview tool.
- Both jobs used the installed OpenCode backend and did not edit files.

Observed jobs:

- `job_c1b97dcb-b4dc-49a0-8c44-8a0c7639d93c` completed a QFerry Codex plugin test-surface audit. It confirmed the exposed MCP tools, existing plugin fixture/QQ read-only/QQ move e2e scripts, trace artifact discipline, and noted gaps such as missing plugin-fixture `fetch` coverage and limited read-only pagination coverage.
- `job_e090bda8-dd99-4e3d-aff1-4ab0c0a62403` completed a Gmail-alignment audit. It identified urgency-based triage and structured search as the next product-level gaps after the cleanup preview workflow.

Findings:

- Retinue is now reliable for short, scoped QFerry read-only audits.
- The batch cleanup preview slice is still valid for the current milestone because it completes the rules -> preview plan -> confirmed execute path.
- The next Gmail-alignment slice should target urgency triage and structured search filters after this batch preview work is verified.

## 2026-05-13 Structured search and urgency triage audit

Context:

- Retinue was used for two concurrent read-only audits before implementing structured search filters and urgency triage buckets.
- The main thread kept implementation decisions and real QQ e2e control.

Observed jobs:

- `job_96595326-bc7a-4c28-b956-35ebd1c348ac` completed the vision guard audit. It confirmed the slice stays aligned with QFerry's QQ Mail Gmail-like organization, Codex-plugin-first, preview-first, traceable-test vision.
- `job_93916bf8-ab0b-4f86-a4bf-8d682d156b0b` completed the structured search risk audit. It recommended in-memory structured filtering after bounded scans as the safest path, and warned against provider-level IMAP filter pushdown for this slice.

Findings:

- Structured metadata filters and priority buckets are a valid next Gmail-alignment step.
- The implementation should remain metadata-only and backward-compatible.
- Provider-level filter pushdown can be revisited later after QQ IMAP behavior is better characterized.

## 2026-05-13 Configurable priority rules audit

Context:

- Retinue was used for two concurrent read-only audits before implementing configurable priority metadata on QFerry classification rules.
- The main thread kept implementation and verification control.

Observed jobs:

- `job_94ecf6c2-e535-42e6-bf32-60ce2c6af260` completed a vision audit. It confirmed configurable priority rules align with Gmail-like organization, metadata-first classification, and traceable testing, while noting schema drift and semantic ambiguity risks.
- `job_8a697bfb-7489-4f9e-8687-046349c36448` completed an implementation audit. It identified the existing hard-coded priority path in `packages/core/src/tools/mail-tools.ts` and recommended backward-compatible ruleset/schema/test updates.

Findings:

- The implementation keeps first-match classification semantics and adds optional per-rule `priority` metadata instead of introducing a separate scoring engine.
- Existing rules without `priority` continue to use built-in metadata heuristics.
- The status privacy bug discovered during installed-plugin smoke was fixed by redacting raw `qqmail.email` from `get_status` output.

## 2026-05-13 Priority weight cross-check

Context:

- Retinue was used for two concurrent read-only audits after the main thread noticed the active goal explicitly included configurable priority rules/weights.
- The main thread used the audit results as a checklist and kept implementation, real QQ e2e, and commit control.

Observed jobs:

- `job_58460975-31cd-4e34-9af9-47b30fedb0cc` completed the vision audit. It confirmed `priority.weight` fits the Gmail-like organization model as an in-bucket ordering signal rather than a separate scoring engine.
- `job_249f5134-cd0b-420c-9ea1-98d7c51899bf` completed the implementation audit. It identified parser, MCP schema, triage passthrough, example config, tests, docs, and e2e trace expectations for `weight`.

Findings:

- `priority.weight` should remain optional, bounded, and local to ordering candidates inside the configured bucket.
- E2E trace summaries now record `priorityBucketWeights` alongside `priorityCounts`, so weight behavior leaves an auditable artifact without logging message bodies or secrets.

## 2026-05-13 Sender governance audit

Context:

- Retinue was used for two concurrent read-only audits while the main thread implemented sender/domain governance planning.
- The main thread kept implementation, real QQ e2e, and product decisions.

Observed jobs:

- `job_ae93535e-ab5d-4db1-a9a3-de2128ab6fd3` stalled after repeated tool-call rounds without a completed assistant text. This is recorded as a Retinue pressure signal, not as QFerry implementation evidence.
- `job_783aa036-d4dd-4888-86b4-9135c509217a` completed the implementation audit. It confirmed the provider boundary: QFerry's QQ mutable provider exposes IMAP `move`, but no server-side blocklist/filter mutation. It also identified the missing persisted `fromDomainIncludes` ruleset support, which this slice added.

Findings:

- Sender/domain governance should remain preview-first: bounded metadata scan, local rule suggestions, and operation plans only for explicitly selected sender/domain filters.
- `serverBlocklistCapability.supported` remains `false` until a provider exposes a real, auditable QQ server-side blocklist API.

## 2026-05-13 Sender ruleset patch audit

Context:

- Retinue was used for two concurrent read-only audits while the main thread extended sender governance from raw suggested rules to an auditable ruleset patch draft.
- The main thread kept implementation, verification, and real QQ e2e control.

Observed jobs:

- `job_bc372713-33f8-40d2-82a9-6b9f0dd78d41` completed the implementation audit. It recommended rendering a complete ruleset draft and changelog from the raw `rulesetPatch` instead of only returning individual rules.
- `job_7ce31331-66ab-46e9-92d2-51c93b12aa20` completed the Gmail-alignment audit. It confirmed the current two-call model, duplicate-rule skip behavior, preview plan boundary, and the explicit QQ server blocklist gap.

Findings:

- `rulesetPatch.renderedDraft` and `rulesetPatch.changelog` were added as in-memory artifacts. They are not written to disk and do not mutate QQ Mail.
- Fixture and QQ readonly e2e summaries now record rendered draft rule counts and changelog line counts alongside sender governance candidate counts.

## 2026-05-13 Governance control layer audit

Context:

- Retinue was used for two concurrent read-only audits while the main thread implemented local ruleset patch dry-run/apply and governance ledger evidence.
- The main thread kept implementation, verification, and real QQ readonly e2e control.

Observed jobs:

- `job_5f71f8f1-5929-4e62-8313-19baeacfd5bf` completed the ledger/e2e audit. It recommended treating the first ledger as a resumable governance record, not only a flat scan offset log.
- `job_b180e2e8-00d1-46ec-9770-82565c783bd5` was still running after the wait window and was closed as a Retinue pressure signal.

Findings:

- The governance ledger now records `resumeToken`, `completedRefsCount`, and `errorCount` in addition to scan/candidate counts and mutation count.
- Fixture and QQ readonly plugin e2e write `governance-ledger.jsonl` under each run artifact directory and link it from the summary.
- UID-based resume is still future work; this slice persists an offset-based resume token so long-running mailbox governance has an auditable starting point without touching QQ Mail.

## 2026-05-13 Cleanup plan consumption audit

Context:

- Retinue was used for concurrent read-only audits after external GPT-5.5 review identified remaining safety-model risks.
- The main thread kept implementation, verification, and product decisions.

Observed jobs:

- `job_d899b69e-9673-4beb-85ae-9b2e703b76ef` completed the documentation drift audit. It found `docs/ARCHITECTURE.md` still conflated confirmation and execution through a single `confirmOperation` contract.
- `job_ab84ebc0-2511-48c3-bfc3-01ce30f27878` did not complete within the wait window and showed read-only patch intent diagnostics, so it was closed as a Retinue pressure/safety signal.

Findings:

- The MCP server now consumes a confirmed `operationPlanId` before calling the provider, so a second `execute_cleanup` attempt for the same id fails as already consumed.
- `docs/ARCHITECTURE.md` now describes `confirmCleanupPlan` and `executeCleanup` as separate steps and records the single-use execution requirement.

## 2026-05-13 Fetch/status and real spam e2e audit attempt

Context:

- Retinue was used for two read-only audits while the main thread fixed QQ `fetchMessage`, status semantics, and prepared a small real spam/ad治理 e2e.
- The main thread kept implementation and real mailbox decisions.

Observed jobs:

- `job_293e8282-f6e1-4ada-83f3-748c9c7900a5` stalled after repeated tool-call rounds without completed assistant text.
- `job_87ad15b4-9e6c-4a21-b925-69b408357a9f` was still running after the wait window and showed read-only patch intent/timeout diagnostics, so it was closed.

Findings:

- Retinue did not return usable review content in this slice; the main thread proceeded from Serena/code evidence.
- The stalled/running behavior remains useful as Retinue pressure-test evidence, but broad audit prompts should be shortened further.

## 2026-05-13 Spam rule review attempt

Context:

- Retinue was used for a narrow read-only review of conservative QQ ad/spam rules before rerunning real move-spam e2e.
- The main thread kept all implementation and mailbox execution control.

Observed jobs:

- `job_51c5ecf0-212a-4329-b96c-ea3b929345d5` timed out with `readOnlyWriteIntent: true` and patch parts instead of a usable textual review.

Findings:

- This is Retinue pressure-test evidence, not QFerry review evidence.
- QFerry proceeded with TDD coverage for importing `scripts/run-qferry-plugin-qq-move-spam-e2e.mjs` without starting a live mailbox run and for the conservative rule set used by real QQ move-spam e2e.
