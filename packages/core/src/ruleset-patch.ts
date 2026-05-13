import type { ClassificationRule } from "./classification.js";
import type { ClassificationGroup, ClassificationRuleset, ClassificationRulesetMetadata } from "./ruleset.js";

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

function formatMatch(match: ClassificationRule["match"]): string {
  return Object.entries(match)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}
