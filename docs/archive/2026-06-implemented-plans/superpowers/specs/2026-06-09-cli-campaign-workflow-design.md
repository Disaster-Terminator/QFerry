# CLI Campaign Workflow Design

## Goal

Add a CLI-first campaign workflow that turns QFerry's existing discovery, local ruleset patching, and ruleset campaign preview tools into one repeatable mailbox-governance loop. The workflow should reduce agent token use and Codex MCP reload friction by letting the framework produce compact, traceable dry-run evidence from terminal commands.

## Problem

QFerry already exposes the pieces needed for Gmail-like QQ Mail governance:

- `planMailboxGovernanceCampaign` discovers high-yield sender/domain candidates across folders.
- `applyRulesetPatchDraft` validates and optionally applies local `qferry.rules.json` patches.
- `rulesetGovernanceCampaignPreview` applies a ruleset across folders and returns compact operation-plan coverage.

The current CLI exposes those pieces as separate commands. That still pushes orchestration back into the agent conversation: choose folders, run discovery, inspect patch candidates, apply a ruleset patch, run preview, write a summary, and decide whether more work is useful. The next iteration should move that loop into the CLI while keeping real mailbox mutation out of scope.

## Command Shape

Add:

```powershell
rtk pnpm run qferry:cli -- campaign-workflow --input .\workflow.json
```

The JSON input is the only schema for this command. This avoids turning command-line flags into a second workflow language.

```json
{
  "runId": "qferry-cli-campaign-workflow-example",
  "folders": ["INBOX", "其他文件夹/GitHub通知"],
  "pageSize": 50,
  "maxPagesPerFolder": 10,
  "order": "oldest",
  "minMessageCount": 10,
  "maxCandidatesPerFolder": 8,
  "maxDistinctSendersForDomainRule": 2,
  "maxConcurrentFolders": 3,
  "rulesFile": "C:\\Users\\Disas\\AppData\\Local\\qferry\\qferry.rules.json",
  "ruleGroup": {
    "id": "advertising_marketing",
    "label": "广告营销",
    "target": { "folder": "广告营销" }
  },
  "applyRulesetPatch": false,
  "preview": {
    "enabled": true,
    "action": "move",
    "maxMessageRefsPerGroup": 100,
    "selectedGroupIds": ["advertising_marketing"],
    "maxUnplannedHintsPerFolder": 5
  }
}
```

## Workflow Semantics

The command runs up to three phases:

1. **Discovery:** call `planMailboxGovernanceCampaign` with the provided folders and optional rule group. This phase is read-only.
2. **Ruleset patch:** if discovery returns rules to add or replace, validate the patch with `applyRulesetPatchDraft`. The default is dry-run. `applyRulesetPatch: true` writes only the local rules file and never mutates QQ Mail.
3. **Campaign preview:** if preview is enabled, call `rulesetGovernanceCampaignPreview` against the ruleset. When `applyRulesetPatch` is true, preview uses the updated rules file. When it is false, preview still runs against the current rules file so users can compare discovery candidates with existing coverage.

The output should be compact by default. It should include:

- `workflow.discovery.campaign.recommendedNextAction`
- `workflow.discovery.campaign.folderSummary`
- `workflow.rulesetPatch.applied`
- `workflow.rulesetPatch.addedRuleCount`
- `workflow.rulesetPatch.replacedRuleCount`
- `workflow.preview.campaign.recommendedNextAction`
- `workflow.preview.campaign.coverageRatio`
- `workflow.preview.campaign.plannedMessages`
- `workflow.preview.campaign.executablePlanCount`
- `workflow.recommendedNextAction`

It should not include full message refs, full classifications, full rendered ruleset drafts, message bodies, auth secrets, or attachment data.

## Safety

The workflow is read-only for QQ Mail. It may write a local `qferry.rules.json` only when `applyRulesetPatch: true` is explicitly present in the input JSON. It must not call `confirm_cleanup_plan` or `execute_cleanup`.

Real QQ mutation remains a separate, explicit, plan-id-based approval path. A future CLI execution command may be added, but it must require an existing server-side operation plan id and explicit user approval. This workflow does not implement that.

## Audit

The command must write trace evidence for every run:

```text
logs/runs/<runId>.jsonl
artifacts/e2e/<runId>/summary.md
```

The summary should show the chained phases, recommendation, coverage, ruleset patch counts, planned messages, and `mutationsAttempted: 0`.

## Testing

Add fixture CLI tests for:

- workflow with dry-run ruleset patch and preview enabled;
- workflow with `applyRulesetPatch: true` mutating only a temporary local rules file;
- workflow audit summary containing discovery, patch, preview, and `mutationsAttempted: 0`;
- invalid inputs that would make the workflow ambiguous, such as preview enabled without `rulesFile`.

Real QQ read-only e2e should be run after implementation through the existing plugin e2e gate. The new workflow may also be smoke-tested with QQ status/list/summary and bounded dry-run input, but it must not execute mailbox mutation.
