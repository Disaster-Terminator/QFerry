import type { ClassificationRule } from "./classification.js";
import { loadClassificationRuleset, parseClassificationRuleset, type ClassificationGroup, type ClassificationRuleset, type ClassificationRulesetMetadata } from "./ruleset.js";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

export interface RulesetPatchDraft {
  groupToEnsure: ClassificationGroup;
  candidateRuleCount: number;
  rulesToReplace?: ClassificationRule[];
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
  replacedRuleCount: number;
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
  const replacementRules = patch.rulesToReplace ?? [];
  assertReplacementRuleIdsAreUnambiguous(replacementRules, patch.rulesToAdd);
  const replacementById = new Map(replacementRules.map((rule) => [rule.id, rule]));
  const replacedRuleIds = new Set<string>();
  const rules = base.rules.map((rule) => {
    const replacement = replacementById.get(rule.id);
    if (!replacement) {
      return rule;
    }
    replacedRuleIds.add(rule.id);
    return replacement;
  });
  const missingReplacementIds = replacementRules
    .map((rule) => rule.id)
    .filter((ruleId) => !replacedRuleIds.has(ruleId));

  if (missingReplacementIds.length > 0) {
    throw new Error(`QFerry ruleset patch replacement target not found: ${missingReplacementIds.join(", ")}`);
  }

  return {
    version: base.version,
    defaultGroupId: base.defaultGroupId,
    groups,
    rules: [...rules, ...patch.rulesToAdd],
  };
}

export function formatRulesetPatchChangelog(patch: RulesetPatchDraft): string {
  const replacementRules = patch.rulesToReplace ?? [];
  return [
    `groupToEnsure: ${patch.groupToEnsure.id}`,
    `candidateRuleCount: ${patch.candidateRuleCount}`,
    ...(replacementRules.length > 0
      ? [
        `rulesToReplace: ${replacementRules.length}`,
        ...replacementRules.map((rule) => `~ rule ${rule.id} (${formatMatch(rule.match)})`),
      ]
      : []),
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
  const existing = await loadPatchableRuleset(input.rulesFile);
  const renderedDraft = renderRulesetPatchDraft(input.patch, existing);
  parseClassificationRuleset(renderedDraft, "ruleset patch draft");
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
    replacedRuleCount: input.patch.rulesToReplace?.length ?? 0,
    skippedDuplicateRuleCount: input.patch.skippedDuplicateRules.length,
    renderedDraft,
    changelog,
  };
}

function assertReplacementRuleIdsAreUnambiguous(
  replacementRules: ClassificationRule[],
  addedRules: ClassificationRule[],
): void {
  const replacementIds = new Set<string>();
  for (const rule of replacementRules) {
    if (replacementIds.has(rule.id)) {
      throw new Error(`QFerry ruleset patch duplicate replacement rule id: ${rule.id}`);
    }
    replacementIds.add(rule.id);
  }

  const addedIds = new Set(addedRules.map((rule) => rule.id));
  const overlappingIds = [...replacementIds].filter((ruleId) => addedIds.has(ruleId));
  if (overlappingIds.length > 0) {
    throw new Error(`QFerry ruleset patch cannot both replace and add rule id: ${overlappingIds.join(", ")}`);
  }
}

async function loadPatchableRuleset(rulesFile: string): Promise<ClassificationRuleset> {
  try {
    return await loadClassificationRuleset(rulesFile);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "QFerry ruleset must contain at least one rule") {
      throw error;
    }
  }

  const raw = JSON.parse(await readFile(rulesFile, "utf8")) as unknown;
  if (raw === null || Array.isArray(raw) || typeof raw !== "object") {
    throw new Error("QFerry ruleset must be a JSON object");
  }
  const draft = raw as Record<string, unknown>;
  if (!Array.isArray(draft.rules) || draft.rules.length !== 0 || typeof draft.defaultGroupId !== "string") {
    throw new Error("QFerry ruleset must contain at least one rule");
  }

  const validated = parseClassificationRuleset({
    ...draft,
    rules: [{
      id: "qferry-bootstrap-placeholder",
      groupId: draft.defaultGroupId,
      match: { subjectIncludes: "__qferry_bootstrap_placeholder__" },
    }],
  }, rulesFile);

  return {
    ...validated,
    rules: [],
    metadata: {
      ...validated.metadata,
      ruleCount: 0,
    },
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
