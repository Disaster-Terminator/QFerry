import { classifyMessages, type ClassificationRule, type MessageClassification, type PriorityBucketId, type PriorityConfidence } from "../classification.js";
import { createOperationPlan, type MessageRef, type OperationAction, type OperationPlan } from "../operation-plan.js";
import type { MailboxInfo, MailboxSummary, MailProvider, MessageDetail, MessageSummary, ProviderCapabilitySnapshot } from "../providers/types.js";
import { loadClassificationRuleset, type ClassificationRulesetMetadata } from "../ruleset.js";
import { formatRulesetPatchChangelog, renderRulesetPatchDraft, type RulesetPatchDraft } from "../ruleset-patch.js";
import type { QFerryRuntimeConfig } from "../runtime-config.js";

const CLIENT_REFS_PLAN_LIMIT = 20;

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

export interface PriorityCandidate {
  message: MessageSummary;
  bucketId: PriorityBucketId;
  reason: string;
  confidence: PriorityConfidence;
  weight: number;
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

export interface PlanSenderGovernanceInput {
  runId: string;
  folder: string;
  pageSize: number;
  maxPages: number;
  maxMessageRefs: number;
  action: OperationAction;
  target?: Record<string, string>;
  scanOffset?: number;
  order?: "newest" | "oldest";
  selectedSenderDomains?: string[];
  selectedFromIncludes?: string[];
  rules?: ClassificationRule[];
  rulesFile?: string;
}

export type BulkGovernanceCategoryId =
  | "high_confidence_marketing"
  | "newsletter_or_digest"
  | "security_or_account"
  | "receipt_or_purchase"
  | "developer_community"
  | "review";

export interface BulkGovernancePreviewInput {
  runId: string;
  folder: string;
  pageSize: number;
  maxPages: number;
  maxMessageRefs: number;
  action: OperationAction;
  target?: Record<string, string>;
  scanOffset?: number;
  order?: "newest" | "oldest";
  selectedCategoryIds: BulkGovernanceCategoryId[];
}

export interface BulkGovernanceCandidate {
  categoryId: BulkGovernanceCategoryId;
  domain: string;
  messageCount: number;
  selectedMessageRefs: number;
  confidence: PriorityConfidence;
  firstDate: string;
  lastDate: string;
  sampleSubjectHashes: string[];
  sampleSubjectLengths: number[];
  sampleSenders: string[];
  reason: string;
}

export interface BulkGovernancePreview {
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
  selectedCategoryIds: BulkGovernanceCategoryId[];
  categoryCounts: Partial<Record<BulkGovernanceCategoryId, number>>;
  categoryCandidates: Partial<Record<BulkGovernanceCategoryId, BulkGovernanceCandidate[]>>;
  mutationsAttempted: 0;
}

export interface SenderGovernanceCandidate {
  domain: string;
  messageCount: number;
  seenCount: number;
  unreadCount: number;
  firstDate: string;
  lastDate: string;
  sampleSubjects: string[];
  senders: string[];
  suggestedRule: ClassificationRule;
}

export interface SenderGovernanceReport {
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
  domainCandidates: SenderGovernanceCandidate[];
  selectedSenderDomains: string[];
  selectedFromIncludes: string[];
  serverBlocklistCapability: {
    supported: false;
    reason: string;
  };
  mutationsAttempted: 0;
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
  planSenderGovernance(input: PlanSenderGovernanceInput): Promise<{
    governance: SenderGovernanceReport;
    rulesetPatch: RulesetPatchDraft;
    plan: OperationPlan;
    mutationsAttempted: 0;
  }>;
  bulkGovernancePreview(input: BulkGovernancePreviewInput): Promise<{
    preview: BulkGovernancePreview;
    plan: OperationPlan;
    mutationsAttempted: 0;
  }>;
}

export function createMailTools(input: CreateMailToolsInput): MailTools {
  return {
    async getStatus() {
      if (input.runtimeConfig) {
        return { status: redactRuntimeConfig(input.runtimeConfig) };
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
          mutationCapable: capability?.supportsMutation ?? false,
          mutationOperationallyReady: capability?.supportsMutation ?? false,
          mutationRequiresConfirmation: capability?.supportsMutation ?? false,
          authConfigured: capability !== undefined,
          providerReady: capability !== undefined,
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
      const priorityBuckets = buildPriorityBuckets(messages, classifications, resolvedRules.rules);

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
        if (planInput.messageRefs.length > CLIENT_REFS_PLAN_LIMIT) {
          throw new Error(`client_refs cleanup plans are limited to ${CLIENT_REFS_PLAN_LIMIT} message refs`);
        }
        return {
          plan: createOperationPlan({
            runId: planInput.runId,
            provider: planInput.messageRefs[0]?.provider ?? input.runtimeConfig?.provider ?? "fixture",
            action: planInput.action,
            messageRefs: planInput.messageRefs,
            target: planInput.target,
            source: "client_refs",
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

    async planSenderGovernance(governanceInput) {
      const existingRuleset = governanceInput.rulesFile
        ? await loadClassificationRuleset(governanceInput.rulesFile)
        : undefined;
      const existingRules = existingRuleset?.rules ?? governanceInput.rules ?? [];
      const pageSize = Math.max(governanceInput.pageSize, 0);
      const maxPages = Math.max(governanceInput.maxPages, 0);
      const maxMessageRefs = Math.max(governanceInput.maxMessageRefs, 0);
      const scanOffset = Math.max(governanceInput.scanOffset ?? 0, 0);
      const scanOrder = governanceInput.order ?? "oldest";
      const messages: MessageSummary[] = [];
      let pagesScanned = 0;

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const page = await input.provider.scanMailboxMetadata({
          folder: governanceInput.folder,
          limit: pageSize,
          order: scanOrder,
          offset: scanOffset + pageIndex * pageSize,
        });
        if (page.length === 0) break;
        pagesScanned += 1;
        messages.push(...page);
        if (page.length < pageSize) break;
      }

      const selectedSenderDomains = governanceInput.selectedSenderDomains ?? [];
      const selectedFromIncludes = governanceInput.selectedFromIncludes ?? [];
      const selectedRefs = messages
        .filter((message) => matchesSenderGovernanceSelection(message, selectedSenderDomains, selectedFromIncludes))
        .map((message) => message.ref)
        .slice(0, maxMessageRefs);
      const provider = selectedRefs[0]?.provider ?? messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";

      const domainCandidates = buildSenderGovernanceCandidates(messages);
      const rulesetPatch = buildRulesetPatchDraft({
        candidates: domainCandidates,
        selectedSenderDomains,
        selectedFromIncludes,
        existingRules,
        ruleset: existingRuleset?.metadata,
      });
      const renderedDraft = renderRulesetPatchDraft(rulesetPatch, existingRuleset);
      const changelog = formatRulesetPatchChangelog(rulesetPatch);

      return {
        governance: {
          provider,
          folder: governanceInput.folder,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned,
          scannedMessages: messages.length,
          selectedMessageRefs: selectedRefs.length,
          maxMessageRefs,
          domainCandidates,
          selectedSenderDomains,
          selectedFromIncludes,
          serverBlocklistCapability: {
            supported: false,
            reason: "Provider capability exposes move only; server-side blocklist or filter mutation is not available through QFerry.",
          },
          mutationsAttempted: 0,
        },
        rulesetPatch: {
          ...rulesetPatch,
          renderedDraft,
          changelog,
        },
        plan: createOperationPlan({
          runId: governanceInput.runId,
          provider,
          action: governanceInput.action,
          messageRefs: selectedRefs,
          target: governanceInput.target,
        }),
        mutationsAttempted: 0,
      };
    },

    async bulkGovernancePreview(bulkInput) {
      const pageSize = Math.max(bulkInput.pageSize, 0);
      const maxPages = Math.max(bulkInput.maxPages, 0);
      const maxMessageRefs = Math.max(bulkInput.maxMessageRefs, 0);
      const scanOffset = Math.max(bulkInput.scanOffset ?? 0, 0);
      const scanOrder = bulkInput.order ?? "oldest";
      const scanWindow = input.provider.scanMailboxMetadataWindow
        ? await input.provider.scanMailboxMetadataWindow({
          folder: bulkInput.folder,
          limit: pageSize,
          maxPages,
          order: scanOrder,
          offset: scanOffset,
        })
        : await scanMetadataWindowWithPages(input.provider, {
          folder: bulkInput.folder,
          limit: pageSize,
          maxPages,
          order: scanOrder,
          offset: scanOffset,
        });
      const messages = scanWindow.messages;
      const pagesScanned = scanWindow.pagesScanned;

      const categorized = messages.map((message) => ({
        message,
        classification: classifyBulkGovernanceMessage(message),
      }));
      const selectedRefs = categorized
        .filter((entry) => bulkInput.selectedCategoryIds.includes(entry.classification.categoryId))
        .map((entry) => entry.message.ref)
        .slice(0, maxMessageRefs);
      const provider = selectedRefs[0]?.provider ?? messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";

      return {
        preview: {
          provider,
          folder: bulkInput.folder,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned,
          scannedMessages: messages.length,
          selectedMessageRefs: selectedRefs.length,
          maxMessageRefs,
          selectedCategoryIds: bulkInput.selectedCategoryIds,
          categoryCounts: countBulkCategories(categorized.map((entry) => entry.classification.categoryId)),
          categoryCandidates: buildBulkGovernanceCandidates(categorized, new Set(selectedRefs.map(messageRefKey))),
          mutationsAttempted: 0,
        },
        plan: createOperationPlan({
          runId: bulkInput.runId,
          provider,
          action: bulkInput.action,
          messageRefs: selectedRefs,
          target: bulkInput.target,
          source: "bulk_governance",
        }),
        mutationsAttempted: 0,
      };
    },
  };
}

function redactRuntimeConfig(config: QFerryRuntimeConfig): QFerryRuntimeConfig {
  if (!config.qqmail) return config;
  const { email: _email, ...qqmail } = config.qqmail;
  return {
    ...config,
    qqmail,
  };
}

async function scanMetadataWindowWithPages(
  provider: MailProvider,
  input: {
    folder: string;
    limit: number;
    maxPages: number;
    order: "newest" | "oldest";
    offset: number;
  },
): Promise<{ messages: MessageSummary[]; pagesScanned: number }> {
  const messages: MessageSummary[] = [];
  let pagesScanned = 0;
  for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
    const page = await provider.scanMailboxMetadata({
      folder: input.folder,
      limit: input.limit,
      order: input.order,
      offset: input.offset + pageIndex * input.limit,
    });
    pagesScanned += 1;
    if (page.length === 0) break;
    messages.push(...page);
    if (page.length < input.limit) break;
  }
  return { messages, pagesScanned };
}

function countGroups(classifications: MessageClassification[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const classification of classifications) {
    counts[classification.groupId] = (counts[classification.groupId] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildPriorityBuckets(
  messages: MessageSummary[],
  classifications: MessageClassification[],
  rules: ClassificationRule[],
): PriorityBucket[] {
  const buckets: PriorityBucket[] = [
    { id: "urgent", label: "Urgent", candidates: [] },
    { id: "needs_review", label: "Needs Review", candidates: [] },
    { id: "waiting", label: "Waiting", candidates: [] },
    { id: "fyi", label: "FYI", candidates: [] },
    { id: "bulk", label: "Bulk", candidates: [] },
  ];
  const byId = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const classificationsByRef = new Map(classifications.map((classification) => [
    messageRefKey(classification.messageRef),
    classification,
  ]));
  const rulePrioritiesById = new Map(rules
    .filter((rule) => rule.priority)
    .map((rule) => [rule.id, rule.priority]));

  for (const message of messages) {
    const classification = classificationsByRef.get(messageRefKey(message.ref));
    const rulePriority = classification?.matchedRuleId
      ? rulePrioritiesById.get(classification.matchedRuleId)
      : undefined;
    const candidate = rulePriority
      ? classifyPriorityFromRule(message, rulePriority)
      : classifyPriority(message);
    byId.get(candidate.bucketId)?.candidates.push(candidate);
  }

  return buckets.map((bucket) => ({
    ...bucket,
    candidates: bucket.candidates.sort((left, right) => right.weight - left.weight),
  }));
}

function classifyPriorityFromRule(
  message: MessageSummary,
  priority: NonNullable<ClassificationRule["priority"]>,
): PriorityCandidate {
  return {
    message,
    bucketId: priority.bucketId,
    reason: priority.reason,
    confidence: priority.confidence,
    weight: priority.weight ?? confidenceWeight(priority.confidence),
    nextAction: priority.nextAction,
  };
}

function confidenceWeight(confidence: PriorityConfidence): number {
  if (confidence === "high") return 80;
  if (confidence === "medium") return 50;
  return 20;
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
      weight: 75,
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
      weight: 60,
      nextAction: "inspect the message or thread before acting",
    };
  }

  if (hasAny(text, ["waiting", "pending", "awaiting", "等候", "等待", "待处理"])) {
    return {
      message,
      bucketId: "waiting",
      reason: "metadata suggests the next blocker may be external",
      confidence: "low",
      weight: 45,
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
      weight: 40,
      nextAction: "archive, move to Junk, or add a rule after review",
    };
  }

  if (message.flags.includes("\\Seen")) {
    return {
      message,
      bucketId: "fyi",
      reason: "message is already seen and has no action-oriented metadata",
      confidence: "low",
      weight: 15,
      nextAction: "leave, archive, or use rules if this sender recurs",
    };
  }

  return {
    message,
    bucketId: "fyi",
    reason: "no action-oriented metadata detected",
    confidence: "low",
    weight: 10,
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

function buildSenderGovernanceCandidates(messages: MessageSummary[]): SenderGovernanceCandidate[] {
  const byDomain = new Map<string, MessageSummary[]>();
  for (const message of messages) {
    const domain = extractSenderDomain(message.from);
    if (!domain) continue;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), message]);
  }

  return [...byDomain.entries()]
    .map(([domain, domainMessages]) => {
      const dates = domainMessages.map((message) => message.date).sort();
      const sampleSubjects = [...new Set(domainMessages.map((message) => message.subject))].slice(0, 3);
      const senders = [...new Set(domainMessages.map((message) => message.from))].slice(0, 5);
      const suggestedRule: ClassificationRule = {
        id: `sender-domain-${slugifyRuleId(domain)}`,
        groupId: "sender_governance",
        match: { fromDomainIncludes: domain },
        priority: {
          bucketId: "bulk",
          reason: `Messages from ${domain} recur in the scanned window`,
          confidence: domainMessages.length > 1 ? "high" : "medium",
          weight: Math.min(100, 50 + domainMessages.length * 10),
          nextAction: "Review sender samples, then preview a move plan or keep as a local rule",
        },
      };
      return {
        domain,
        messageCount: domainMessages.length,
        seenCount: domainMessages.filter((message) => message.flags.includes("\\Seen")).length,
        unreadCount: domainMessages.filter((message) => !message.flags.includes("\\Seen")).length,
        firstDate: dates[0] ?? "",
        lastDate: dates[dates.length - 1] ?? "",
        sampleSubjects,
        senders,
        suggestedRule,
      };
    })
    .sort((left, right) => right.messageCount - left.messageCount || left.domain.localeCompare(right.domain));
}

function classifyBulkGovernanceMessage(message: MessageSummary): {
  categoryId: BulkGovernanceCategoryId;
  confidence: PriorityConfidence;
  reason: string;
} {
  const domain = extractSenderDomain(message.from);
  const text = `${message.from}\n${message.subject}\n${message.snippet}`.toLocaleLowerCase();

  if (hasAny(domain, ["wargaming.net", "postermaster.sony.com.cn"])
    || hasAny(text, ["广告", "(ad)", "优惠", "促销", "特卖", "礼物已到位", "登录游戏即可", "promotion", "promo"])) {
    return { categoryId: "high_confidence_marketing", confidence: "high", reason: "metadata matches known marketing sender or promotion subject pattern" };
  }

  if (hasAny(text, ["安全代码", "security code", "异常登录", "new sign-in", "验证码", "验证", "account", "帐户", "账号"])) {
    return { categoryId: "security_or_account", confidence: "high", reason: "metadata indicates account, login, verification, or security mail" };
  }

  if (hasAny(text, ["购买", "receipt", "invoice", "账单", "订单", "payment", "支付", "subscription"])) {
    return { categoryId: "receipt_or_purchase", confidence: "high", reason: "metadata indicates a receipt, purchase, payment, or subscription" };
  }

  if (hasAny(text, ["newsletter", "digest", "unsubscribe", "退订", "周报", "月报"])) {
    return { categoryId: "newsletter_or_digest", confidence: "medium", reason: "metadata indicates newsletter, digest, or unsubscribe-capable bulk mail" };
  }

  if (hasAny(domain, ["github.com", "codeforces.com", "gitee.com", "oschina.net"])
    || hasAny(text, ["codeforces round", "pull request", "issue", "commit"])) {
    return { categoryId: "developer_community", confidence: "medium", reason: "metadata indicates developer community or repository activity" };
  }

  return { categoryId: "review", confidence: "low", reason: "no high-confidence bulk governance category matched" };
}

function countBulkCategories(categoryIds: BulkGovernanceCategoryId[]): Partial<Record<BulkGovernanceCategoryId, number>> {
  const counts: Partial<Record<BulkGovernanceCategoryId, number>> = {};
  for (const categoryId of categoryIds) {
    counts[categoryId] = (counts[categoryId] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildBulkGovernanceCandidates(
  categorized: Array<{
    message: MessageSummary;
    classification: { categoryId: BulkGovernanceCategoryId; confidence: PriorityConfidence; reason: string };
  }>,
  selectedRefKeys: Set<string>,
): Partial<Record<BulkGovernanceCategoryId, BulkGovernanceCandidate[]>> {
  const grouped = new Map<string, Array<typeof categorized[number]>>();
  for (const entry of categorized) {
    const domain = extractSenderDomain(entry.message.from) || "<unknown>";
    const key = `${entry.classification.categoryId}\0${domain}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  const candidates: Partial<Record<BulkGovernanceCategoryId, BulkGovernanceCandidate[]>> = {};
  for (const entries of grouped.values()) {
    const first = entries[0];
    if (!first) continue;
    const categoryId = first.classification.categoryId;
    const domain = extractSenderDomain(first.message.from) || "<unknown>";
    const dates = entries.map((entry) => entry.message.date).sort();
    const candidate: BulkGovernanceCandidate = {
      categoryId,
      domain,
      messageCount: entries.length,
      selectedMessageRefs: entries.filter((entry) => selectedRefKeys.has(messageRefKey(entry.message.ref))).length,
      confidence: highestConfidence(entries.map((entry) => entry.classification.confidence)),
      firstDate: dates[0] ?? "",
      lastDate: dates[dates.length - 1] ?? "",
      sampleSubjectHashes: [...new Set(entries.map((entry) => hashText(entry.message.subject)))].slice(0, 3),
      sampleSubjectLengths: [...new Set(entries.map((entry) => entry.message.subject.length))].slice(0, 3),
      sampleSenders: [...new Set(entries.map((entry) => redactSender(entry.message.from)))].slice(0, 3),
      reason: first.classification.reason,
    };
    candidates[categoryId] = [...(candidates[categoryId] ?? []), candidate]
      .sort((left, right) => right.messageCount - left.messageCount || left.domain.localeCompare(right.domain));
  }
  return candidates;
}

function highestConfidence(confidences: PriorityConfidence[]): PriorityConfidence {
  if (confidences.includes("high")) return "high";
  if (confidences.includes("medium")) return "medium";
  return "low";
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function redactSender(value: string): string {
  const domain = extractSenderDomain(value);
  if (!domain) return "<unknown>";
  const displayName = value.includes("<") ? value.slice(0, value.indexOf("<")).trim() : "";
  return displayName ? `${displayName} <***@${domain}>` : `***@${domain}`;
}

function buildRulesetPatchDraft(input: {
  candidates: SenderGovernanceCandidate[];
  selectedSenderDomains: string[];
  selectedFromIncludes: string[];
  existingRules: ClassificationRule[];
  ruleset?: ClassificationRulesetMetadata;
}): RulesetPatchDraft {
  const selectedRules = [
    ...input.candidates
      .filter((candidate) => input.selectedSenderDomains
        .some((selectedDomain) => includesIgnoreCase(candidate.domain, selectedDomain)))
      .map((candidate) => candidate.suggestedRule),
    ...input.selectedFromIncludes.map((fromNeedle) => buildSenderRule(fromNeedle)),
  ];
  const rulesToAdd: ClassificationRule[] = [];
  const skippedDuplicateRules: RulesetPatchDraft["skippedDuplicateRules"] = [];

  for (const rule of selectedRules) {
    const duplicate = input.existingRules.find((existingRule) => sameRuleMatch(existingRule.match, rule.match));
    if (duplicate) {
      skippedDuplicateRules.push({
        ruleId: duplicate.id,
        reason: "match already covered by existing rule",
        match: duplicate.match,
      });
    } else if (!rulesToAdd.some((existingRule) => sameRuleMatch(existingRule.match, rule.match))) {
      rulesToAdd.push(rule);
    }
  }

  return {
    groupToEnsure: { id: "sender_governance", label: "Sender governance" },
    candidateRuleCount: selectedRules.length,
    rulesToAdd,
    skippedDuplicateRules,
    ruleset: input.ruleset,
  };
}

function buildSenderRule(fromNeedle: string): ClassificationRule {
  return {
    id: `sender-from-${slugifyRuleId(fromNeedle)}`,
    groupId: "sender_governance",
    match: { fromIncludes: fromNeedle },
    priority: {
      bucketId: "bulk",
      reason: `Messages matching sender ${fromNeedle} were selected for governance`,
      confidence: "medium",
      weight: 60,
      nextAction: "Review sender samples, then preview a move plan or keep as a local rule",
    },
  };
}

function sameRuleMatch(left: ClassificationRule["match"], right: ClassificationRule["match"]): boolean {
  return normalizeOptional(left.fromIncludes) === normalizeOptional(right.fromIncludes)
    && normalizeOptional(left.fromDomainIncludes) === normalizeOptional(right.fromDomainIncludes)
    && normalizeOptional(left.subjectIncludes) === normalizeOptional(right.subjectIncludes)
    && normalizeOptional(left.snippetIncludes) === normalizeOptional(right.snippetIncludes)
    && normalizeOptional(left.folderEquals) === normalizeOptional(right.folderEquals)
    && normalizeOptional(left.hasFlag) === normalizeOptional(right.hasFlag);
}

function normalizeOptional(value: string | undefined): string | undefined {
  return value?.toLocaleLowerCase();
}

function matchesSenderGovernanceSelection(
  message: MessageSummary,
  selectedSenderDomains: string[],
  selectedFromIncludes: string[],
): boolean {
  if (selectedSenderDomains.length === 0 && selectedFromIncludes.length === 0) return false;
  const domain = extractSenderDomain(message.from);
  return selectedSenderDomains.some((selectedDomain) => includesIgnoreCase(domain, selectedDomain))
    || selectedFromIncludes.some((fromNeedle) => includesIgnoreCase(message.from, fromNeedle));
}

function slugifyRuleId(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
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
