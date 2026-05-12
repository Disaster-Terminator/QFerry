import { classifyMessages, type ClassificationRule, type MessageClassification } from "../classification.js";
import { createOperationPlan, type MessageRef, type OperationAction, type OperationPlan } from "../operation-plan.js";
import type { MailboxInfo, MailProvider, MessageDetail, MessageSummary, ProviderCapabilitySnapshot } from "../providers/types.js";
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
}

export interface ClassifyMessagesToolInput {
  folder: string;
  limit: number;
  rules?: ClassificationRule[];
  defaultGroupId?: string;
  rulesFile?: string;
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
  getCapabilitySnapshot(): Promise<{ capability: ProviderCapabilitySnapshot }>;
  search(input: SearchMessagesInput): Promise<{ messages: MessageSummary[] }>;
  fetch(ref: MessageRef): Promise<{ message: MessageDetail }>;
  classifyMessages(input: ClassifyMessagesToolInput): Promise<{
    classifications: MessageClassification[];
    ruleset?: ClassificationRulesetMetadata;
  }>;
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
