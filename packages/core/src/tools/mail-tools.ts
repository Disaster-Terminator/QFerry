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
  offset?: number;
  fromIncludes?: string;
  fromDomainIncludes?: string;
  subjectIncludes?: string;
  snippetIncludes?: string;
  hasFlag?: string;
  dateAfter?: string;
  dateBefore?: string;
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
  offset?: number;
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

export type PriorityBucketId = "urgent" | "needs_review" | "waiting" | "fyi" | "bulk";

export interface PriorityCandidate {
  message: MessageSummary;
  bucketId: PriorityBucketId;
  reason: string;
  confidence: "high" | "medium" | "low";
  nextAction: string;
}

export interface PriorityBucket {
  id: PriorityBucketId;
  label: string;
  candidates: PriorityCandidate[];
}

export interface PlanCleanupInput {
  runId: string;
  folder: string;
  limit: number;
  action: OperationAction;
  target?: Record<string, string>;
  messageRefs?: MessageRef[];
  rules?: ClassificationRule[];
  rulesFile?: string;
  defaultGroupId?: string;
  selectedGroupIds: string[];
}

export interface PreviewCleanupBatchInput {
  runId: string;
  folder: string;
  pageSize: number;
  maxPages: number;
  maxMessageRefs: number;
  action: OperationAction;
  target?: Record<string, string>;
  scanOffset?: number;
  order?: "newest" | "oldest";
  rules?: ClassificationRule[];
  rulesFile?: string;
  defaultGroupId?: string;
  selectedGroupIds: string[];
}

export interface CleanupBatchPreview {
  provider: string;
  folder: string;
  scanOrder: "newest" | "oldest";
  scanOffset: number;
  pageSize: number;
  maxPages: number;
  pagesScanned: number;
  scannedMessages: number;
  selectedMessageRefs: number;
  maxMessageRefs: number;
  groupCounts: Record<string, number>;
  sampledMessages: MessageSummary[];
  selectedGroups: Record<string, SpamCandidate[]>;
  ruleset?: ClassificationRulesetMetadata;
  mutationsAttempted: 0;
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
    priorityBuckets: PriorityBucket[];
    priorityCounts: Record<PriorityBucketId, number>;
    ruleset?: ClassificationRulesetMetadata;
    mutationsAttempted: 0;
  }>;
  groupSpamCandidates(input: GroupSpamCandidatesInput): Promise<{
    folder: string;
    scannedMessages: number;
    scanOrder: "oldest";
    scanOffset: number;
    sampledMessages: MessageSummary[];
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
  previewCleanupBatch(input: PreviewCleanupBatchInput): Promise<{
    preview: CleanupBatchPreview;
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
        offset: searchInput.offset,
      });

      return {
        messages: messages.filter((message) => matchesSearchInput(message, searchInput)),
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
      const priorityBuckets = buildPriorityBuckets(messages);

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
        priorityBuckets,
        priorityCounts: countPriorityBuckets(priorityBuckets),
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
        offset: candidateInput.offset,
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
        scanOffset: Math.max(candidateInput.offset ?? 0, 0),
        sampledMessages: messages,
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
      if (planInput.messageRefs && planInput.messageRefs.length > 0) {
        return {
          plan: createOperationPlan({
            runId: planInput.runId,
            provider: planInput.messageRefs[0]?.provider ?? input.runtimeConfig?.provider ?? "fixture",
            action: planInput.action,
            messageRefs: planInput.messageRefs,
            target: planInput.target,
          }),
          classifications: [],
          mutationsAttempted: 0,
        };
      }

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

    async previewCleanupBatch(batchInput) {
      const resolvedRules = await resolveRules({
        ...batchInput,
        defaultGroupId: batchInput.defaultGroupId ?? "review",
      });
      const pageSize = Math.max(batchInput.pageSize, 0);
      const maxPages = Math.max(batchInput.maxPages, 0);
      const maxMessageRefs = Math.max(batchInput.maxMessageRefs, 0);
      const scanOffset = Math.max(batchInput.scanOffset ?? 0, 0);
      const scanOrder = batchInput.order ?? "oldest";
      const messages: MessageSummary[] = [];
      const classifications: MessageClassification[] = [];
      let pagesScanned = 0;

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const page = await input.provider.scanMailboxMetadata({
          folder: batchInput.folder,
          limit: pageSize,
          order: scanOrder,
          offset: scanOffset + pageIndex * pageSize,
        });
        if (page.length === 0) break;
        pagesScanned += 1;
        messages.push(...page);
        classifications.push(...classifyMessages({
          messages: page,
          rules: resolvedRules.rules,
          defaultGroupId: resolvedRules.defaultGroupId,
        }));
        if (page.length < pageSize) break;
      }

      const selectedClassifications = classifications.filter((classification) =>
        batchInput.selectedGroupIds.includes(classification.groupId));
      const selectedRefs = selectedClassifications
        .map((classification) => classification.messageRef)
        .slice(0, maxMessageRefs);
      const selectedRefKeys = new Set(selectedRefs.map(messageRefKey));
      const selectedGroups = groupSpamCandidates(
        messages,
        selectedClassifications.filter((classification) => selectedRefKeys.has(messageRefKey(classification.messageRef))),
      );
      const provider = selectedRefs[0]?.provider ?? messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";

      return {
        preview: {
          provider,
          folder: batchInput.folder,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned,
          scannedMessages: messages.length,
          selectedMessageRefs: selectedRefs.length,
          maxMessageRefs,
          groupCounts: countGroups(classifications),
          sampledMessages: messages.slice(0, Math.min(messages.length, 10)),
          selectedGroups,
          ruleset: resolvedRules.ruleset,
          mutationsAttempted: 0,
        },
        plan: createOperationPlan({
          runId: batchInput.runId,
          provider,
          action: batchInput.action,
          messageRefs: selectedRefs,
          target: batchInput.target,
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

function buildPriorityBuckets(messages: MessageSummary[]): PriorityBucket[] {
  const buckets: PriorityBucket[] = [
    { id: "urgent", label: "Urgent", candidates: [] },
    { id: "needs_review", label: "Needs Review", candidates: [] },
    { id: "waiting", label: "Waiting", candidates: [] },
    { id: "fyi", label: "FYI", candidates: [] },
    { id: "bulk", label: "Bulk", candidates: [] },
  ];
  const byId = new Map(buckets.map((bucket) => [bucket.id, bucket]));

  for (const message of messages) {
    const candidate = classifyPriority(message);
    byId.get(candidate.bucketId)?.candidates.push(candidate);
  }

  return buckets;
}

function countPriorityBuckets(buckets: PriorityBucket[]): Record<PriorityBucketId, number> {
  return {
    urgent: buckets.find((bucket) => bucket.id === "urgent")?.candidates.length ?? 0,
    needs_review: buckets.find((bucket) => bucket.id === "needs_review")?.candidates.length ?? 0,
    waiting: buckets.find((bucket) => bucket.id === "waiting")?.candidates.length ?? 0,
    fyi: buckets.find((bucket) => bucket.id === "fyi")?.candidates.length ?? 0,
    bulk: buckets.find((bucket) => bucket.id === "bulk")?.candidates.length ?? 0,
  };
}

function classifyPriority(message: MessageSummary): PriorityCandidate {
  const text = `${message.from}\n${message.subject}\n${message.snippet}`.toLocaleLowerCase();

  if (hasAny(text, [
    "security alert",
    "安全",
    "风险",
    "urgent",
    "asap",
    "deadline",
    "today",
    "action required",
    "立即",
    "截止",
  ])) {
    return {
      message,
      bucketId: "urgent",
      reason: "metadata indicates security, risk, deadline, or time pressure",
      confidence: "medium",
      nextAction: "review first and decide whether a response or cleanup is needed",
    };
  }

  if (hasAny(text, [
    "please reply",
    "reply",
    "request",
    "question",
    "follow up",
    "follow-up",
    "请",
    "回复",
    "确认",
    "问题",
  ])) {
    return {
      message,
      bucketId: "needs_review",
      reason: "metadata looks like a direct ask or follow-up",
      confidence: "low",
      nextAction: "inspect the message or thread before acting",
    };
  }

  if (hasAny(text, ["waiting", "pending", "awaiting", "等候", "等待", "待处理"])) {
    return {
      message,
      bucketId: "waiting",
      reason: "metadata suggests the next blocker may be external",
      confidence: "low",
      nextAction: "keep for tracking unless it is stale",
    };
  }

  if (hasAny(text, [
    "newsletter",
    "digest",
    "unsubscribe",
    "promotion",
    "promo",
    "广告",
    "优惠",
    "退订",
  ])) {
    return {
      message,
      bucketId: "bulk",
      reason: "metadata looks like newsletter, digest, promotion, or other bulk mail",
      confidence: "medium",
      nextAction: "archive, move to Junk, or add a rule after review",
    };
  }

  if (message.flags.includes("\\Seen")) {
    return {
      message,
      bucketId: "fyi",
      reason: "message is already seen and has no action-oriented metadata",
      confidence: "low",
      nextAction: "leave, archive, or use rules if this sender recurs",
    };
  }

  return {
    message,
    bucketId: "fyi",
    reason: "no action-oriented metadata detected",
    confidence: "low",
    nextAction: "review only if the sender or subject matters",
  };
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

function messageRefKey(ref: MessageRef): string {
  return `${ref.provider}\0${ref.accountAlias}\0${ref.folder}\0${ref.uid}\0${ref.uidValidity ?? ""}`;
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

function matchesSearchInput(message: MessageSummary, input: SearchMessagesInput): boolean {
  if (input.query && !matchesQuery(message, input.query)) return false;
  if (input.fromIncludes && !includesIgnoreCase(message.from, input.fromIncludes)) return false;
  if (input.fromDomainIncludes && !includesIgnoreCase(extractSenderDomain(message.from), input.fromDomainIncludes)) return false;
  if (input.subjectIncludes && !includesIgnoreCase(message.subject, input.subjectIncludes)) return false;
  if (input.snippetIncludes && !includesIgnoreCase(message.snippet, input.snippetIncludes)) return false;
  if (input.hasFlag && !message.flags.includes(input.hasFlag)) return false;
  if (input.dateAfter && new Date(message.date).getTime() < new Date(input.dateAfter).getTime()) return false;
  if (input.dateBefore && new Date(message.date).getTime() > new Date(input.dateBefore).getTime()) return false;
  return true;
}

function matchesQuery(message: MessageSummary, query: string): boolean {
  return [message.from, message.subject, message.snippet, message.ref.folder]
    .some((value) => includesIgnoreCase(value, query));
}

function includesIgnoreCase(value: string, needle: string): boolean {
  return value.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLocaleLowerCase()));
}

function extractSenderDomain(from: string): string {
  const match = from.match(/@([^>\s]+)/);
  return match?.[1] ?? "";
}
