import { readFile } from "node:fs/promises";

import type { ClassificationRule, ClassificationRulePriority } from "./classification.js";

export interface ClassificationGroup {
  id: string;
  label: string;
}

export interface ClassificationRulesetMetadata {
  source: string;
  version: string;
  defaultGroupId: string;
  groupCount: number;
  ruleCount: number;
}

export interface ClassificationRuleset {
  version: string;
  defaultGroupId: string;
  groups: ClassificationGroup[];
  rules: ClassificationRule[];
  metadata: ClassificationRulesetMetadata;
}

export async function loadClassificationRuleset(path: string): Promise<ClassificationRuleset> {
  const text = await readFile(path, "utf8");
  return parseClassificationRuleset(JSON.parse(text) as unknown, path);
}

export function parseClassificationRuleset(value: unknown, source: string): ClassificationRuleset {
  if (!isRecord(value)) {
    throw new Error("QFerry ruleset must be a JSON object");
  }

  const version = readString(value, "version");
  const defaultGroupId = readString(value, "defaultGroupId");
  const groups = readGroups(value.groups);
  const rules = readRules(value.rules);
  const groupIds = new Set(groups.map((group) => group.id));

  if (!groupIds.has(defaultGroupId)) {
    throw new Error(`QFerry ruleset defaultGroupId is not declared in groups: ${defaultGroupId}`);
  }
  for (const rule of rules) {
    if (!groupIds.has(rule.groupId)) {
      throw new Error(`QFerry ruleset rule references unknown groupId: ${rule.groupId}`);
    }
  }

  return {
    version,
    defaultGroupId,
    groups,
    rules,
    metadata: {
      source,
      version,
      defaultGroupId,
      groupCount: groups.length,
      ruleCount: rules.length,
    },
  };
}

function readGroups(value: unknown): ClassificationGroup[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("QFerry ruleset must contain at least one group");
  }
  return value.map((group, index) => {
    if (!isRecord(group)) {
      throw new Error(`QFerry ruleset group at index ${index} must be an object`);
    }
    return {
      id: readString(group, "id"),
      label: readString(group, "label"),
    };
  });
}

function readRules(value: unknown): ClassificationRule[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("QFerry ruleset must contain at least one rule");
  }
  return value.map((rule, index) => {
    if (!isRecord(rule)) {
      throw new Error(`QFerry ruleset rule at index ${index} must be an object`);
    }
    const match = rule.match;
    if (!isRecord(match)) {
      throw new Error(`QFerry ruleset rule at index ${index} must include a match object`);
    }
    const normalizedMatch = Object.fromEntries(
      Object.entries(match).filter(([, entryValue]) => entryValue !== undefined),
    );
    if (Object.keys(normalizedMatch).length === 0) {
      throw new Error(`QFerry ruleset rule at index ${index} must match at least one metadata field`);
    }
    for (const [key, entryValue] of Object.entries(normalizedMatch)) {
      if (!["fromIncludes", "fromDomainIncludes", "subjectIncludes", "snippetIncludes", "folderEquals", "hasFlag"].includes(key)) {
        throw new Error(`QFerry ruleset rule at index ${index} has unsupported match field: ${key}`);
      }
      if (typeof entryValue !== "string" || entryValue.length === 0) {
        throw new Error(`QFerry ruleset rule at index ${index} match field ${key} must be a non-empty string`);
      }
    }
    return {
      id: readString(rule, "id"),
      groupId: readString(rule, "groupId"),
      match: normalizedMatch,
      priority: readPriority(rule.priority, index),
    };
  });
}

function readPriority(value: unknown, ruleIndex: number): ClassificationRulePriority | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`QFerry ruleset rule at index ${ruleIndex} priority must be an object`);
  }
  const bucketId = readString(value, "bucketId");
  if (!["urgent", "needs_review", "waiting", "fyi", "bulk"].includes(bucketId)) {
    throw new Error(`QFerry ruleset rule at index ${ruleIndex} priority bucketId is unsupported: ${bucketId}`);
  }
  const confidence = readString(value, "confidence");
  if (!["high", "medium", "low"].includes(confidence)) {
    throw new Error(`QFerry ruleset rule at index ${ruleIndex} priority confidence is unsupported: ${confidence}`);
  }
  return {
    bucketId: bucketId as ClassificationRulePriority["bucketId"],
    reason: readString(value, "reason"),
    confidence: confidence as ClassificationRulePriority["confidence"],
    weight: readOptionalWeight(value, ruleIndex),
    nextAction: readString(value, "nextAction"),
  };
}

function readOptionalWeight(record: Record<string, unknown>, ruleIndex: number): number | undefined {
  const value = record.weight;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`QFerry ruleset rule at index ${ruleIndex} priority weight must be a number from 0 to 100`);
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`QFerry ruleset field ${key} must be a non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
