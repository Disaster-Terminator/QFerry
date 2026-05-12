import { readFile } from "node:fs/promises";

import type { ClassificationRule } from "./classification.js";

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
      if (!["fromIncludes", "subjectIncludes", "snippetIncludes", "folderEquals", "hasFlag"].includes(key)) {
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
    };
  });
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
