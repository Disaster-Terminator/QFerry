# Fixture E2E

Date: 2026-05-12

This e2e path verifies QFerry's trace-first flow without touching QQ Mail, Gmail, or any real mailbox provider.

Run:

```bash
pnpm qferry:e2e:fixture
```

Expected behavior:

- provider is `fixture`
- `dryRun` is `true`
- `mutationAllowed` is `false`
- `mutationsAttempted` is `0`
- a trace JSONL file is written
- a human summary is written
- an operation plan JSON is written
- the operation plan is `preview` status
- the operation plan contains message refs, not full message bodies

Artifact layout:

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
artifacts/e2e/<runId>/operation-plan.json
```

Example validated run:

```text
runId: fixture-e2e-20260512T103736Z-5a721c71
trace: G:\repository\QFerry\logs\runs\fixture-e2e-20260512T103736Z-5a721c71.jsonl
summary: G:\repository\QFerry\artifacts\e2e\fixture-e2e-20260512T103736Z-5a721c71\summary.md
operationPlan: G:\repository\QFerry\artifacts\e2e\fixture-e2e-20260512T103736Z-5a721c71\operation-plan.json
```

This is the first e2e gate before adding real QQ read-only provider behavior.
