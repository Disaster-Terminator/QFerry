import type { ClassificationRule } from "./classification.js";
import { loadClassificationRuleset, type ClassificationGroup, type ClassificationRuleset, type ClassificationRulesetMetadata } from "./ruleset.js";
import { realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

export interface RulesetPatchDraft {
  groupToEnsure: { id: "sender_governance"; label: "Sender governance" };
  candidateRuleCount: number;
  rulesToAdd: ClassificationRule[];
  skippedDuplicateRules: Array<{
    ruleId: string;
    reason: "match already covered by existing rule";
    match: ClassificationRule["match"];
  }>;
  ruleset?: ClassificationRulesetMetadata;
  renderedDraft?: ClassificationRulesetJsonDraft;
  changelog?: string;
}

export interface ClassificationRulesetJsonDraft {
  version: string;
  defaultGroupId: string;
  groups: ClassificationGroup[];
  rules: ClassificationRule[];
}

export interface ApplyRulesetPatchDraftInput {
  rulesFile: string;
  patch: RulesetPatchDraft;
  apply: boolean;
}

export interface ApplyRulesetPatchDraftResult {
  applied: boolean;
  rulesFile: string;
  beforeRuleCount: number;
  afterRuleCount: number;
  addedRuleCount: number;
  skippedDuplicateRuleCount: number;
  renderedDraft: ClassificationRulesetJsonDraft;
  changelog: string;
}

const DEFAULT_RULESET_DRAFT: ClassificationRulesetJsonDraft = {
  version: "sender-governance-draft",
  defaultGroupId: "review",
  groups: [{ id: "review", label: "Needs review" }],
  rules: [],
};

export function renderRulesetPatchDraft(
  patch: RulesetPatchDraft,
  existing?: ClassificationRuleset,
): ClassificationRulesetJsonDraft {
  const base = existing
    ? {
      version: existing.version,
      defaultGroupId: existing.defaultGroupId,
      groups: existing.groups,
      rules: existing.rules,
    }
    : DEFAULT_RULESET_DRAFT;
  const groups = base.groups.some((group) => group.id === patch.groupToEnsure.id)
    ? base.groups
    : [...base.groups, patch.groupToEnsure];

  return {
    version: base.version,
    defaultGroupId: base.defaultGroupId,
    groups,
    rules: [...base.rules, ...patch.rulesToAdd],
  };
}

export function formatRulesetPatchChangelog(patch: RulesetPatchDraft): string {
  return [
    `groupToEnsure: ${patch.groupToEnsure.id}`,
    `candidateRuleCount: ${patch.candidateRuleCount}`,
    `rulesToAdd: ${patch.rulesToAdd.length}`,
    ...patch.rulesToAdd.map((rule) => `+ rule ${rule.id} (${formatMatch(rule.match)})`),
    `skippedDuplicateRules: ${patch.skippedDuplicateRules.length}`,
    ...patch.skippedDuplicateRules.map((duplicate) =>
      `skipped ${duplicate.ruleId}: ${duplicate.reason} (${formatMatch(duplicate.match)})`),
  ].join("\n");
}

export async function applyRulesetPatchDraft(
  input: ApplyRulesetPatchDraftInput,
): Promise<ApplyRulesetPatchDraftResult> {
  const existing = await loadClassificationRuleset(input.rulesFile);
  const renderedDraft = renderRulesetPatchDraft(input.patch, existing);
  const changelog = formatRulesetPatchChangelog(input.patch);

  if (input.apply) {
    const safeRulesFile = await resolveWritableRulesFile(input.rulesFile);
    await writeFile(safeRulesFile, `${JSON.stringify(renderedDraft, null, 2)}\n`, "utf8");
  }

  return {
    applied: input.apply,
    rulesFile: input.rulesFile,
    beforeRuleCount: existing.rules.length,
    afterRuleCount: renderedDraft.rules.length,
    addedRuleCount: input.patch.rulesToAdd.length,
    skippedDuplicateRuleCount: input.patch.skippedDuplicateRules.length,
    renderedDraft,
    changelog,
  };
}

async function resolveWritableRulesFile(rulesFile: string): Promise<string> {
  const resolved = resolve(rulesFile);
  if (basename(resolved) !== "qferry.rules.json" || extname(resolved) !== ".json") {
    throw new Error("QFerry can only apply ruleset patches to qferry.rules.json");
  }

  const parent = await realpath(dirname(resolved));
  const file = await realpath(resolved);
  if (dirname(file) !== parent) {
    throw new Error("QFerry rulesFile must resolve inside its containing directory");
  }

  return file;
}

function formatMatch(match: ClassificationRule["match"]): string {
  return Object.entries(match)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}
