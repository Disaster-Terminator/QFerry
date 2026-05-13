import type { MessageRef } from "./operation-plan.js";
import type { MessageSummary } from "./providers/types.js";

export interface ClassificationRuleMatch {
  fromIncludes?: string;
  fromDomainIncludes?: string;
  subjectIncludes?: string;
  snippetIncludes?: string;
  folderEquals?: string;
  hasFlag?: string;
}

export type PriorityBucketId = "urgent" | "needs_review" | "waiting" | "fyi" | "bulk";
export type PriorityConfidence = "high" | "medium" | "low";

export interface ClassificationRulePriority {
  bucketId: PriorityBucketId;
  reason: string;
  confidence: PriorityConfidence;
  nextAction: string;
  weight?: number;
}

export interface ClassificationRule {
  id: string;
  groupId: string;
  match: ClassificationRuleMatch;
  priority?: ClassificationRulePriority;
}

export interface ClassifyMessagesInput {
  messages: MessageSummary[];
  rules: ClassificationRule[];
  defaultGroupId: string;
}

export interface MessageClassification {
  messageRef: MessageRef;
  groupId: string;
  matchedRuleId?: string;
  explanation: string;
}

export function classifyMessages(input: ClassifyMessagesInput): MessageClassification[] {
  return input.messages.map((message) => {
    for (const rule of input.rules) {
      const explanation = explainMatch(rule.match, message);
      if (explanation) {
        return {
          messageRef: message.ref,
          groupId: rule.groupId,
          matchedRuleId: rule.id,
          explanation,
        };
      }
    }

    return {
      messageRef: message.ref,
      groupId: input.defaultGroupId,
      matchedRuleId: undefined,
      explanation: "no rule matched",
    };
  });
}

function explainMatch(match: ClassificationRuleMatch, message: MessageSummary): string | undefined {
  const parts: string[] = [];

  if (match.fromIncludes !== undefined) {
    if (!includesIgnoreCase(message.from, match.fromIncludes)) return undefined;
    parts.push(`from includes ${match.fromIncludes}`);
  }

  if (match.fromDomainIncludes !== undefined) {
    if (!includesIgnoreCase(extractSenderDomain(message.from), match.fromDomainIncludes)) return undefined;
    parts.push(`from domain includes ${match.fromDomainIncludes}`);
  }

  if (match.subjectIncludes !== undefined) {
    if (!includesIgnoreCase(message.subject, match.subjectIncludes)) return undefined;
    parts.push(`subject includes ${match.subjectIncludes}`);
  }

  if (match.snippetIncludes !== undefined) {
    if (!includesIgnoreCase(message.snippet, match.snippetIncludes)) return undefined;
    parts.push(`snippet includes ${match.snippetIncludes}`);
  }

  if (match.folderEquals !== undefined) {
    if (message.ref.folder !== match.folderEquals) return undefined;
    parts.push(`folder equals ${match.folderEquals}`);
  }

  if (match.hasFlag !== undefined) {
    if (!message.flags.includes(match.hasFlag)) return undefined;
    parts.push(`has flag ${match.hasFlag}`);
  }

  return parts.length > 0 ? parts.join("; ") : undefined;
}

function includesIgnoreCase(value: string, needle: string): boolean {
  return value.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function extractSenderDomain(from: string): string {
  const match = from.match(/@([^>\s]+)/);
  return match?.[1] ?? "";
}
