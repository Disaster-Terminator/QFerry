import { classifyMessages, type ClassificationRule, type MessageClassification } from "../classification.js";
import { createOperationPlan, type MessageRef, type OperationAction, type OperationPlan } from "../operation-plan.js";
import type { MailboxInfo, MailProvider, MessageDetail, MessageSummary } from "../providers/types.js";

export interface CreateMailToolsInput {
  provider: MailProvider;
}

export interface SearchMessagesInput {
  folder: string;
  limit: number;
  query?: string;
}

export interface ClassifyMessagesToolInput {
  folder: string;
  limit: number;
  rules: ClassificationRule[];
  defaultGroupId: string;
}

export interface PlanCleanupInput {
  runId: string;
  folder: string;
  limit: number;
  action: OperationAction;
  target?: Record<string, string>;
  rules: ClassificationRule[];
  selectedGroupIds: string[];
}

export interface MailTools {
  listMailboxes(): Promise<{ mailboxes: MailboxInfo[] }>;
  search(input: SearchMessagesInput): Promise<{ messages: MessageSummary[] }>;
  fetch(ref: MessageRef): Promise<{ message: MessageDetail }>;
  classifyMessages(input: ClassifyMessagesToolInput): Promise<{ classifications: MessageClassification[] }>;
  planCleanup(input: PlanCleanupInput): Promise<{
    plan: OperationPlan;
    classifications: MessageClassification[];
    mutationsAttempted: 0;
  }>;
}

export function createMailTools(input: CreateMailToolsInput): MailTools {
  return {
    async listMailboxes() {
      return { mailboxes: await input.provider.listMailboxes() };
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
      const messages = await input.provider.scanMailboxMetadata({
        folder: classifyInput.folder,
        limit: classifyInput.limit,
      });
      return {
        classifications: classifyMessages({
          messages,
          rules: classifyInput.rules,
          defaultGroupId: classifyInput.defaultGroupId,
        }),
      };
    },

    async planCleanup(planInput) {
      const messages = await input.provider.scanMailboxMetadata({
        folder: planInput.folder,
        limit: planInput.limit,
      });
      const classifications = classifyMessages({
        messages,
        rules: planInput.rules,
        defaultGroupId: "review",
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
        mutationsAttempted: 0,
      };
    },
  };
}

function matchesQuery(message: MessageSummary, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  return [message.from, message.subject, message.snippet, message.ref.folder]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}
