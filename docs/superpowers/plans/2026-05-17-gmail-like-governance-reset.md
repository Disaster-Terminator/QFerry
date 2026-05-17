# Gmail-Like Governance Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-center QFerry on a Gmail-like generic mailbox governance framework: user-defined rules, filters, groups, target folders, batch preview, explicit confirmation, and auditable execution.

**Architecture:** Keep QQ Mail as an IMAP folder provider, but stop making fixed business categories the core workflow. Core should expose generic search/ruleset/classification/group-plan primitives; mailbox-specific behavior belongs in provider adapters and user rules files. Built-in category helpers may remain temporarily as discovery aids, but they must not be the primary mutation path.

**Tech Stack:** TypeScript, `pnpm`, MCP server, QFerry core providers, fixture and QQ Mail e2e traces.

---

## Current Findings

The current direction drifted in three concrete ways:

- `classification_sweep`, `classification_map`, and `bulk_governance_preview` center the workflow on a hardcoded `BulkGovernanceCategoryId` union in `packages/core/src/tools/mail-tools.ts`.
- Several categories are product/domain-specific (`github_ci`, `github_pr_notification`, `github_code_review`, `github_account_security`) and require code changes when user mailbox reality changes.
- Documentation presents fixed category sweep as the Gmail-like default, while Gmail's durable abstraction is closer to search/filter/rule/label-or-folder actions.

The half-finished `rulesetGovernancePreview` draft from the previous turn was removed from the working tree before writing this plan because it declared an interface without implementation and used real mailbox category names in a core test.

## Document Governance

Prototype-era planning documents have been moved under `docs/archive/2026-05-prototype/`.

Active docs should now have these roles:

- `README.md`: user-facing install, safety model, and current tool map.
- `docs/ARCHITECTURE.md`: durable product architecture and provider boundaries.
- `docs/CODEX_PLUGIN_ACCEPTANCE.md`: installation, reload, and e2e acceptance.
- `docs/RETINUE_E2E_NOTES.md`: Retinue dogfood notes and plugin workflow evidence.
- `docs/WHEEL_AUDIT.md`: historical research reference, not a product contract.

The next implementation pass should update these active docs after code changes, not before, so docs reflect tested behavior.

## Target Workflow

The intended workflow is:

```text
discover folders and provider capabilities
-> scan or search bounded metadata
-> classify with a user ruleset
-> produce group counts and per-group target previews
-> create missing target folders through preview/confirm/execute when needed
-> generate one operation plan per selected group or one resumable batch plan with grouped sections
-> confirm and execute with audit traces
```

This is the QQ Mail equivalent of Gmail-style efficiency: define filters once, preview all matches, then apply in batches. It is not manual per-message triage and not a fixed classifier baked into the product.

## Product Alignment

The user need is mailbox governance, not mail drafting. The framework must help organize, classify, identify, process, and archive existing QQ Mail messages across a mailbox that has accumulated for many years.

The accepted QQ Mail model is folder-based classification:

- QFerry may create user-named folders after preview/confirmation.
- QFerry may move matching messages into those folders after preview/confirmation.
- QFerry does not need Gmail multi-label semantics for QQ Mail to satisfy the current workflow.
- Folder names and classification groups must come from user rules, local ruleset files, or an explicit preview session. They must not be hardcoded in core product logic.

The efficiency target is Gmail-like batch governance:

- A rule or filter should identify all matching messages inside the scanned scope.
- The framework should produce group-level counts and operation plans, not force the agent to hand-pick small UID lists.
- Small execution batches are acceptable only as an IMAP stability control after a large preview has selected the full matching set.
- Every dry-run and mutation must leave traceable evidence under `logs/runs/` and `artifacts/e2e/`.

## Non-Goals

- Do not add Gmail multi-label semantics to QQ Mail execution. QQ Mail folders are sufficient for the current user need.
- Do not remove existing hardcoded category tools in one breaking change. Deprecate and route around them first.
- Do not commit real mailbox rules, private senders, or sensitive trace data.
- Do not perform real mailbox mutation as part of framework refactoring unless a specific preview plan is approved.

## Decisions For This Reset

- `ruleset_governance_preview` becomes the primary high-throughput governance entry point after it lands.
- `classification_sweep`, `classification_map`, and `bulk_governance_preview` remain available for compatibility, but they are legacy discovery helpers, not the recommended mutation path.
- Search parsing is part of this milestone. Gmail-like governance is not credible if a user cannot express filters such as `from:`, `subject:`, `after:`, and `before:`.
- QQ Mail's user-folder root must be provider configuration, not a generic core assumption. The default may still resolve to the QQ user-folder root, but code that is not QQ-specific should not hardcode that folder name.
- Folder reconciliation is a first-class primitive: resolving a target folder, checking whether it exists, previewing creation when missing, and moving messages are separate steps.
- Execution batching is a transport and reconciliation safety detail. The selected set must come from a large preview of all matching messages in the scanned scope.

## Task 1: Archive Boundary Verification

**Files:**
- Review: `docs/archive/2026-05-prototype/README.md`
- Review: `README.md`
- Review: `docs/ARCHITECTURE.md`
- Review: `docs/CODEX_PLUGIN_ACCEPTANCE.md`

- [ ] **Step 1: Verify the archive only contains historical files**

Run:

```powershell
rtk rg --files -g "*.md" -g "*.mdx"
```

Expected:

```text
HANDOFF.md is under docs/archive/2026-05-prototype/
docs/superpowers/plans/ contains only this current reset plan unless new active plans are added
docs/superpowers/specs/ is empty or contains only current approved specs
```

- [ ] **Step 2: Check active docs do not point to archived plans as current truth**

Run:

```powershell
rtk rg -n "docs/superpowers/plans/2026-05-1[23]|HANDOFF.md|prototype archive|current product contract" README.md docs plugins/qferry
```

Expected:

```text
No active doc tells users to follow archived prototype plans as current instructions.
```

- [ ] **Step 3: Commit document governance separately**

Run after review approval:

```powershell
rtk git status --short
rtk pnpm run check
git add README.md docs AGENTS.md plugins/qferry
git commit -m "docs: archive prototype planning notes"
```

Expected: document-only commit, unless this plan is approved together with the code reset.

## Task 2: Add Provider Folder Strategy And Reconciliation Vocabulary

**Files:**
- Modify: `packages/core/src/runtime-config.ts`
- Modify: `packages/core/src/tools/mail-tools.ts`
- Test: `packages/core/test/mail-tools.test.ts`

- [ ] **Step 1: Add a failing test for configurable folder root**

Add a test that proves target resolution uses provider/runtime configuration instead of a hardcoded generic core path:

```ts
it("resolves classification targets through provider folder strategy", async () => {
  const tools = createMailTools({
    runtimeConfig: {
      provider: "qqmail",
      accountAlias: "demo",
      metadataSampleLimit: 1,
      statusWarnings: [],
      qqmail: {
        email: "demo@qq.com",
        imapHost: "imap.qq.com",
        imapPort: 993,
        metadataSampleLimit: 1,
        classificationParentPath: "User Folders",
      },
    },
    provider: fixtureProvider,
  });

  const result = await tools.ensureClassificationFolder({
    runId: "folder-strategy",
    displayName: "Group Alpha",
  });

  expect(result.folder.fullPath).toBe("User Folders/Group Alpha");
});
```

Run:

```powershell
rtk pnpm exec vitest run packages/core/test/mail-tools.test.ts -t "folder strategy"
```

Expected: fail until runtime config carries a provider folder strategy.

- [ ] **Step 2: Implement provider folder strategy**

Add a QQ runtime config field such as:

```ts
classificationParentPath?: string;
```

Resolution rules:

```text
explicit target folder with slash -> literal target
explicit target folder without slash -> provider classification parent + display name
ensureClassificationFolder parentPath input -> overrides provider default for that call
missing config on QQ -> use the QQ provider default
fixture provider -> use fixture default
```

Do not expose the provider default as a universal core constant.

- [ ] **Step 3: Define reconciliation terms in code**

Use naming that separates:

```text
targetResolution: chosen target path
folderPreview: folder exists or create-folder plan
movePlan: message move operation plan
moveReconciliation: post-execute source/target count evidence
```

This can be a type/documentation cleanup if existing behavior already covers it.

- [ ] **Step 4: Run targeted tests**

Run:

```powershell
rtk pnpm exec vitest run packages/core/test/mail-tools.test.ts -t "folder strategy|classification folder|target folder"
```

Expected: pass.

- [ ] **Step 5: Commit folder strategy**

Run:

```powershell
rtk git add packages/core/src/runtime-config.ts packages/core/src/tools/mail-tools.ts packages/core/test/mail-tools.test.ts
rtk git commit -m "feat: add provider folder strategy"
```

Expected: folder naming is provider-configurable before generic governance relies on it.

## Task 3: Define Generic Ruleset Governance Preview

**Files:**
- Modify: `packages/core/src/tools/mail-tools.ts`
- Test: `packages/core/test/mail-tools.test.ts`

- [ ] **Step 1: Add a failing core test with neutral fixture names**

Add a test that uses only generic group ids and neutral domains:

```ts
it("previews ruleset governance by user-defined groups and targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qferry-mail-tools-ruleset-governance-"));
  const rulesFile = join(dir, "qferry.rules.json");
  await writeFile(
    rulesFile,
    JSON.stringify({
      version: "rules-governance",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "group_alpha", label: "Group Alpha", target: { folder: "Folders/Group Alpha" } },
        { id: "group_beta", label: "Group Beta", target: { folder: "Folders/Group Beta" } },
      ],
      rules: [
        { id: "alpha-domain", groupId: "group_alpha", match: { fromDomainIncludes: "alpha.example" } },
        { id: "beta-domain", groupId: "group_beta", match: { fromDomainIncludes: "beta.example" } },
      ],
    }),
    "utf8",
  );
  // Fixture messages should include two alpha, one beta, one review.
});
```

Run:

```powershell
rtk pnpm exec vitest run packages/core/test/mail-tools.test.ts -t "ruleset governance"
```

Expected: fail because `rulesetGovernancePreview` is not implemented.

- [ ] **Step 2: Implement `rulesetGovernancePreview` without hardcoded categories**

Add public input/output types that reference `ClassificationGroup`, `ClassificationRule`, and `OperationPlan`, not `BulkGovernanceCategoryId`.

Core behavior:

```text
resolve rules -> scan metadata window once -> classify messages by ruleset -> count groups
-> for selected groups with target.folder -> create preview OperationPlan
-> return preview.groupPlans, skippedGroups, plans, classifications, mutationsAttempted: 0
```

The method must not mention GitHub, AI tools, contests, marketing, or any other real user category.

- [ ] **Step 3: Run the targeted core test**

Run:

```powershell
rtk pnpm exec vitest run packages/core/test/mail-tools.test.ts -t "ruleset governance"
```

Expected: pass.

- [ ] **Step 4: Commit core generic preview**

Run:

```powershell
rtk git add packages/core/src/tools/mail-tools.ts packages/core/test/mail-tools.test.ts
rtk git commit -m "feat: add generic ruleset governance preview"
```

Expected: one focused commit.

## Task 4: Expose Generic Preview Through MCP

**Files:**
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Test: `apps/chatgpt-app/test/mcp-server.test.ts`

- [ ] **Step 1: Add a failing MCP tool-list test**

Assert `ruleset_governance_preview` appears in the tool list and is preview-first:

```ts
expect(toolNames).toContain("ruleset_governance_preview");
expect(tools.tools.find((tool) => tool.name === "ruleset_governance_preview")?.annotations?.destructiveHint).toBe(false);
```

Run:

```powershell
rtk pnpm exec vitest run apps/chatgpt-app/test/mcp-server.test.ts -t "tool"
```

Expected: fail until the tool is registered.

- [ ] **Step 2: Register the MCP tool**

Input schema should mirror the core method:

```text
runId, folder, pageSize, maxPages, maxMessageRefsPerGroup, action,
rules, rulesFile, defaultGroupId, selectedGroupIds, scanOffset, order
```

Do not use `selectedCategoryIds`.

- [ ] **Step 3: Register multiple returned plans**

Replace the single-plan-only helper with a helper that can register all returned operation plans:

```ts
function registerOperationPlans<T extends { plan?: OperationPlan; plans?: OperationPlan[] }>(
  result: T,
  registry: Map<string, StoredPlan>,
): T {
  const plans = result.plans ?? (result.plan ? [result.plan] : []);
  for (const plan of plans) {
    registry.set(plan.operationPlanId, {
      plan,
      expiresAt: Date.now() + PLAN_TTL_MS,
      previewSummary: summarizeMcpToolResult(result),
    });
  }
  return result;
}
```

- [ ] **Step 4: Extend audit summaries for multi-plan previews**

Add summary fields for:

```text
operationPlanIds
groupPlans
skippedGroups
```

Existing single-plan audit behavior must remain unchanged.

- [ ] **Step 5: Run targeted MCP tests**

Run:

```powershell
rtk pnpm exec vitest run apps/chatgpt-app/test/mcp-server.test.ts -t "ruleset governance"
```

Expected: pass with trace/audit summary assertions.

- [ ] **Step 6: Commit MCP exposure**

Run:

```powershell
rtk git add apps/chatgpt-app/src/mcp-server.ts apps/chatgpt-app/test/mcp-server.test.ts
rtk git commit -m "feat: expose ruleset governance preview tool"
```

Expected: one focused commit.

## Task 5: Reframe Hardcoded Category Tools As Legacy Discovery

**Files:**
- Modify: `packages/core/src/tools/mail-tools.ts`
- Modify: `apps/chatgpt-app/src/mcp-server.ts`
- Modify: `plugins/qferry/skills/qferry/SKILL.md`
- Modify: `README.md`
- Modify: `docs/CODEX_PLUGIN_ACCEPTANCE.md`

- [x] **Step 1: Rename documentation language, not APIs**

Keep existing tool names for compatibility, but describe them as "built-in discovery heuristics" rather than "the Gmail-like default workflow".

Required doc changes:

```text
Preferred governance path: ruleset_governance_preview
Legacy/discovery path: classification_sweep, classification_map, bulk_governance_preview
```

- [x] **Step 2: Add deprecation metadata and response warnings where safe**

Do not break clients. Add wording to tool descriptions:

```text
Use this only for exploratory built-in heuristic discovery. For user-defined batch governance, prefer ruleset_governance_preview.
```

Add structured response warnings for legacy discovery tools when applicable:

```json
{
  "workflowWarning": {
    "code": "legacy_discovery_helper",
    "message": "For repeatable batch governance, prefer a user ruleset and ruleset_governance_preview."
  }
}
```

The warning must not fail existing calls or change mutation safety.

- [x] **Step 3: Run docs and MCP tests**

Run:

```powershell
rtk pnpm run check
```

Expected: pass.

- [x] **Step 4: Commit compatibility docs**

Run:

```powershell
rtk git add README.md docs plugins/qferry/skills/qferry/SKILL.md apps/chatgpt-app/src/mcp-server.ts
rtk git commit -m "docs: reframe built-in classifiers as discovery helpers"
```

Expected: no behavior regression.

## Task 6: Improve Search/Filter Expressiveness

**Files:**
- Create: `packages/core/src/search-query.ts`
- Modify: `packages/core/src/tools/mail-tools.ts`
- Test: `packages/core/test/search-query.test.ts`

- [ ] **Step 1: Add tests for Gmail-like query parsing**

Cover these inputs:

```text
from:alpha.example
subject:(invoice)
after:2025/01/01 before:2026/01/01
in:INBOX
```

Expected parsed form:

```ts
{
  fromDomainIncludes: "alpha.example",
  subjectIncludes: "invoice",
  dateAfter: "2025-01-01",
  dateBefore: "2026-01-01",
  folder: "INBOX"
}
```

- [ ] **Step 2: Implement a minimal parser**

Keep the first parser small and deterministic. Unsupported Gmail operators should return a structured warning rather than being silently ignored.

- [ ] **Step 3: Wire search tools to the parser**

Allow `search.query` to be parsed into existing structured filters. Existing explicit fields still win over parsed fields.

- [ ] **Step 4: Commit search parser**

Run:

```powershell
rtk pnpm exec vitest run packages/core/test/search-query.test.ts
rtk git add packages/core/src/search-query.ts packages/core/src/tools/mail-tools.ts packages/core/test/search-query.test.ts
rtk git commit -m "feat: parse basic Gmail-like search queries"
```

Expected: query parsing is useful without becoming a full Gmail clone.

## Task 7: Full Verification And Plugin Reload

**Files:**
- Verify: `plugins/qferry/dist/mcp.cjs`
- Verify: installed QFerry plugin cache

- [ ] **Step 1: Run full checks**

Run:

```powershell
rtk pnpm run check
rtk pnpm run qferry:e2e:plugin-qq-readonly
```

Expected:

```text
all tests pass
real QQ readonly e2e writes logs/runs and artifacts/e2e
mutationsAttempted: 0
```

- [ ] **Step 2: Sync plugin cache**

Run:

```powershell
rtk pnpm run dev:sync-plugin-cache:all -- --apply
```

Expected: Windows plugin cache and detectable WSL cache are updated.

- [ ] **Step 3: Commit generated distribution**

Run:

```powershell
rtk git status --short
rtk git add plugins/qferry/dist plugins/qferry/skills/qferry/SKILL.md README.md docs apps packages
rtk git commit -m "chore: sync qferry plugin bundle"
```

Expected: source and plugin distribution stay consistent.

## Task 8: Real Mailbox Dogfood After User Reload

**Files:**
- Runtime artifacts only: `logs/runs/`
- Runtime artifacts only: `artifacts/e2e/`

- [ ] **Step 1: Confirm the new tool is visible**

After Codex reload, call QFerry status and tool list through the installed plugin.

Expected:

```text
ruleset_governance_preview is available
```

- [ ] **Step 2: Run a large dry-run with local in-memory rules**

Use user-approved rule groups, but do not commit them:

```text
folder: INBOX
pageSize: 50
maxPages: enough for a meaningful window
maxMessageRefsPerGroup: 50 to 500 depending on stability
mutationsAttempted: 0
```

Expected:

```text
groupCounts show useful coverage
groupPlans are created per target group
trace and summary include operationPlanIds
```

- [ ] **Step 3: Execute only after explicit approval**

When the preview looks right, ask for approval of specific `operationPlanId` values and execute with controlled `maxMessages`.

Expected:

```text
target folder reconciliation succeeds
remaining messages are resumable under the same plan if partially executed
```

## Review Checklist

- The plan removes the fixed-category path from the primary workflow without breaking existing tools.
- The core implementation task contains no real user categories or private senders.
- User-defined rules, groups, and target folders are the source of truth for classification.
- Large dry-runs operate over all matching messages in the scanned scope; execution batching is only a transport safety detail.
- Real mailbox mutation remains preview/confirm/execute only.
- Traceability remains first-class for both read-only and mutation e2e.
- Each implementation stage can be committed independently.
