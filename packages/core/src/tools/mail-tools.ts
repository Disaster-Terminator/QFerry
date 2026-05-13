import { classifyMessages, type ClassificationRule, type MessageClassification } from "../classification.js";
import { createOperationPlan, type MessageRef, type OperationAction, type OperationPlan } from "../operation-plan.js";
import type { MailboxInfo, MailboxSummary, MailProvider, MessageDetail, MessageSummary, ProviderCapabilitySnapshot } from "../providers/types.js";
import { loadClassificationRuleset, type ClassificationRulesetMetadata } from "../ruleset.js";
import type { QFerryRuntimeConfig } from "../runtime-config.js";

export interface CreateMailToolsInput {
  provider: MailProvider;
  runtimeConfig?: QFerryRuntimeConfig;
}

export interface SearchMessagesInput {
  folder: string;
  limit: number;
  query?: string;
  order?: "newest" | "oldest";
}

export interface ClassifyMessagesToolInput {
  folder: string;
  limit: number;
  rules?: ClassificationRule[];
  defaultGroupId?: string;
  rulesFile?: string;
}

export interface TriageInboxInput extends ClassifyMessagesToolInput {}

export interface GetMailboxSummaryInput {
  folder: string;
}

export interface GroupSpamCandidatesInput {
  folder: string;
  limit: number;
  rules?: ClassificationRule[];
  rulesFile?: string;
}

export interface ExecuteCleanupInput {
  plan: OperationPlan;
}

export interface ExecuteCleanupResult {
  operationPlanId: string;
  status: "blocked" | "executed";
  action: OperationAction;
  attemptedMessages: number;
  mutationsAttempted: number;
  moved?: number;
}

export interface SpamCandidate {
  message: MessageSummary;
  groupId: string;
  matchedRuleId?: string;
  explanation: string;
}

export interface InboxTriageReport {
  provider: string;
  folder: string;
  sampledMessages: number;
  groupCounts: Record<string, number>;
  recommendedNextAction: "review_preview_plan";
  mutationsAttempted: 0;
}

export interface PlanCleanupInput {
  runId: string;
  folder: string;
  limit: number;
  action: OperationAction;
  target?: Record<string, string>;
  rules?: ClassificationRule[];
  rulesFile?: string;
  defaultGroupId?: string;
  selectedGroupIds: string[];
}

export interface MailTools {
  getStatus(): Promise<{
    status: QFerryRuntimeConfig;
  }>;
  listMailboxes(): Promise<{ mailboxes: MailboxInfo[] }>;
  getMailboxSummary(input: GetMailboxSummaryInput): Promise<{ mailbox: MailboxSummary }>;
  getCapabilitySnapshot(): Promise<{ capability: ProviderCapabilitySnapshot }>;
  search(input: SearchMessagesInput): Promise<{ messages: MessageSummary[] }>;
  fetch(ref: MessageRef): Promise<{ message: MessageDetail }>;
  classifyMessages(input: ClassifyMessagesToolInput): Promise<{
    classifications: MessageClassification[];
    ruleset?: ClassificationRulesetMetadata;
  }>;
  triageInbox(input: TriageInboxInput): Promise<{
    triage: InboxTriageReport;
    classifications: MessageClassification[];
    ruleset?: ClassificationRulesetMetadata;
    mutationsAttempted: 0;
  }>;
  groupSpamCandidates(input: GroupSpamCandidatesInput): Promise<{
    folder: string;
    scannedMessages: number;
    scanOrder: "oldest";
    groups: Record<string, SpamCandidate[]>;
    classifications: MessageClassification[];
    mutationsAttempted: 0;
  }>;
  executeCleanup(input: ExecuteCleanupInput): Promise<{ result: ExecuteCleanupResult }>;
  planCleanup(input: PlanCleanupInput): Promise<{
    plan: OperationPlan;
    classifications: MessageClassification[];
    ruleset?: ClassificationRulesetMetadata;
    mutationsAttempted: 0;
  }>;
}

export function createMailTools(input: CreateMailToolsInput): MailTools {
  return {
    async getStatus() {
      if (input.runtimeConfig) {
        return { status: input.runtimeConfig };
      }
      const capability = input.provider.getCapabilitySnapshot
        ? await input.provider.getCapabilitySnapshot()
        : undefined;
      return {
        status: {
          provider: capability?.provider === "qqmail" ? "qqmail" : "fixture",
          accountAlias: capability?.accountAlias ?? "demo",
          configSource: "provider",
          mutationAllowed: false,
          metadataSampleLimit: capability?.maxRecommendedScanLimit ?? 1,
          statusWarnings: [],
        },
      };
    },

    async listMailboxes() {
      return { mailboxes: await input.provider.listMailboxes() };
    },

    async getMailboxSummary(summaryInput) {
      if (!input.provider.getMailboxSummary) {
        throw new Error("Provider does not expose mailbox summaries");
      }
      return { mailbox: await input.provider.getMailboxSummary(summaryInput.folder) };
    },

    async getCapabilitySnapshot() {
      if (!input.provider.getCapabilitySnapshot) {
        throw new Error("Provider does not expose a capability snapshot");
      }
      return { capability: await input.provider.getCapabilitySnapshot() };
    },

    async search(searchInput) {
      const messages = await input.provider.scanMailboxMetadata({
        folder: searchInput.folder,
        limit: searchInput.limit,
        order: searchInput.order,
      });

      return {
        messages: searchInput.query
          ? messages.filter((message) => matchesQuery(message, searchInput.query ?? ""))
          : messages,
      };
    },

    async fetch(ref) {
      return { message: await input.provider.fetchMessage(ref) };
    },

    async classifyMessages(classifyInput) {
      const resolvedRules = await resolveRules(classifyInput);
      const messages = await input.provider.scanMailboxMetadata({
        folder: classifyInput.folder,
        limit: classifyInput.limit,
      });
      return {
        classifications: classifyMessages({
          messages,
          rules: resolvedRules.rules,
          defaultGroupId: resolvedRules.defaultGroupId,
        }),
        ruleset: resolvedRules.ruleset,
      };
    },

    async triageInbox(triageInput) {
      const resolvedRules = await resolveRules(triageInput);
      const messages = await input.provider.scanMailboxMetadata({
        folder: triageInput.folder,
        limit: triageInput.limit,
      });
      const classifications = classifyMessages({
        messages,
        rules: resolvedRules.rules,
        defaultGroupId: resolvedRules.defaultGroupId,
      });

      return {
        triage: {
          provider: messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture",
          folder: triageInput.folder,
          sampledMessages: messages.length,
          groupCounts: countGroups(classifications),
          recommendedNextAction: "review_preview_plan",
          mutationsAttempted: 0,
        },
        classifications,
        ruleset: resolvedRules.ruleset,
        mutationsAttempted: 0,
      };
    },

    async groupSpamCandidates(candidateInput) {
      const resolvedRules = await resolveRules({
        ...candidateInput,
        defaultGroupId: "review",
      });
      const messages = await input.provider.scanMailboxMetadata({
        folder: candidateInput.folder,
        limit: candidateInput.limit,
        order: "oldest",
      });
      const classifications = classifyMessages({
        messages,
        rules: resolvedRules.rules,
        defaultGroupId: resolvedRules.defaultGroupId,
      });
      const spamClassifications = classifications.filter((classification) => classification.groupId !== resolvedRules.defaultGroupId);
      return {
        folder: candidateInput.folder,
        scannedMessages: messages.length,
        scanOrder: "oldest",
        groups: groupSpamCandidates(messages, spamClassifications),
        classifications,
        mutationsAttempted: 0,
      };
    },

    async executeCleanup(executeInput) {
      const plan = executeInput.plan;
      if (plan.status !== "confirmed") {
        throw new Error("Operation plan must be confirmed before execution");
      }
      const capability = input.provider.getCapabilitySnapshot
        ? await input.provider.getCapabilitySnapshot()
        : undefined;
      if (!capability?.supportsMutation) {
        throw new Error("Provider does not support mailbox mutation");
      }
      if (plan.action !== "move") {
        throw new Error(`Unsupported execute_cleanup action: ${plan.action}`);
      }
      const targetFolder = plan.target?.folder;
      if (!targetFolder) {
        throw new Error("Move execution requires target.folder");
      }
      if (!input.provider.moveMessages) {
        throw new Error("Provider does not implement moveMessages");
      }

      const moveResult = await input.provider.moveMessages(plan.messageRefs, targetFolder);
      return {
        result: {
          operationPlanId: plan.operationPlanId,
          status: "executed",
          action: plan.action,
          attemptedMessages: plan.messageRefs.length,
          mutationsAttempted: plan.messageRefs.length,
          moved: moveResult.moved,
        },
      };
    },

    async planCleanup(planInput) {
      const resolvedRules = await resolveRules({
        ...planInput,
        defaultGroupId: planInput.defaultGroupId ?? "review",
      });
      const messages = await input.provider.scanMailboxMetadata({
        folder: planInput.folder,
        limit: planInput.limit,
      });
      const classifications = classifyMessages({
        messages,
        rules: resolvedRules.rules,
        defaultGroupId: resolvedRules.defaultGroupId,
      });
      const selectedRefs = classifications
        .filter((classification) => planInput.selectedGroupIds.includes(classification.groupId))
        .map((classification) => classification.messageRef);

      return {
        plan: createOperationPlan({
          runId: planInput.runId,
          provider: selectedRefs[0]?.provider ?? "fixture",
          action: planInput.action,
          messageRefs: selectedRefs,
          target: planInput.target,
        }),
        classifications,
        ruleset: resolvedRules.ruleset,
        mutationsAttempted: 0,
      };
    },
  };
}

function countGroups(classifications: MessageClassification[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const classification of classifications) {
    counts[classification.groupId] = (counts[classification.groupId] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function groupSpamCandidates(messages: MessageSummary[], classifications: MessageClassification[]): Record<string, SpamCandidate[]> {
  const byRef = new Map(messages.map((message) => [message.ref.uid, message]));
  const groups: Record<string, SpamCandidate[]> = {};
  for (const classification of classifications) {
    const message = byRef.get(classification.messageRef.uid);
    if (!message) continue;
    groups[classification.groupId] = groups[classification.groupId] ?? [];
    groups[classification.groupId].push({
      message,
      groupId: classification.groupId,
      matchedRuleId: classification.matchedRuleId,
      explanation: classification.explanation,
    });
  }
  return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)));
}

async function resolveRules(input: {
  rules?: ClassificationRule[];
  defaultGroupId?: string;
  rulesFile?: string;
}): Promise<{
  rules: ClassificationRule[];
  defaultGroupId: string;
  ruleset?: ClassificationRulesetMetadata;
}> {
  if (input.rulesFile) {
    const ruleset = await loadClassificationRuleset(input.rulesFile);
    return {
      rules: ruleset.rules,
      defaultGroupId: input.defaultGroupId ?? ruleset.defaultGroupId,
      ruleset: ruleset.metadata,
    };
  }

  if (!input.rules || input.rules.length === 0) {
    throw new Error("QFerry requires inline rules or rulesFile");
  }
  if (!input.defaultGroupId) {
    throw new Error("QFerry requires defaultGroupId when using inline rules");
  }

  return {
    rules: input.rules,
    defaultGroupId: input.defaultGroupId,
  };
}

function matchesQuery(message: MessageSummary, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  return [message.from, message.subject, message.snippet, message.ref.folder]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}
