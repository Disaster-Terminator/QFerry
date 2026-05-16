import { classifyMessages, type ClassificationRule, type MessageClassification, type PriorityBucketId, type PriorityConfidence } from "../classification.js";
import { createOperationPlan, type MessageRef, type OperationAction, type OperationPlan } from "../operation-plan.js";
import type { MailboxInfo, MailboxSummary, MailProvider, MailboxWindowSnapshot, MessageDetail, MessageSummary, MoveMessagesReconciliation, ProviderCapabilitySnapshot, ScanMailboxMetadataWindowResult } from "../providers/types.js";
import { loadClassificationRuleset, type ClassificationGroup, type ClassificationRulesetMetadata } from "../ruleset.js";
import { formatRulesetPatchChangelog, renderRulesetPatchDraft, type RulesetPatchDraft } from "../ruleset-patch.js";
import type { QFerryRuntimeConfig } from "../runtime-config.js";

const CLIENT_REFS_PLAN_LIMIT = 20;
const MOVE_RECONCILE_ATTEMPTS = 10;
const MOVE_RECONCILE_DELAY_MS = 1_000;
const DEFAULT_CLASSIFICATION_PARENT_PATH = "其他文件夹";
const DEFAULT_SENDER_GOVERNANCE_CANDIDATE_LIMIT = 10;

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
  maxMessages?: number;
}

export interface ExecuteCleanupResult {
  operationPlanId: string;
  status: "blocked" | "executed" | "partially_executed";
  action: OperationAction;
  attemptedMessages: number;
  mutationsAttempted: number;
  moved?: number;
  totalPlanMessages?: number;
  remainingMessages?: number;
  executionBatch?: {
    requestedMaxMessages: number;
    executedMessages: number;
  };
  reconciliations?: Array<{
    sourceFolder: string;
    targetFolder: string;
    sourceBefore: number;
    sourceAfter: number;
    sourceDelta: number;
    targetBefore: number;
    targetAfter: number;
    targetDelta: number;
    expectedSourceDelta: number;
    expectedTargetDelta: number;
    targetDeltaReconciled: boolean;
    sourceDeltaReliable: boolean;
    sourceDeltaStatus: "matched" | "concurrent_or_external_change";
  }>;
  createdFolder?: string;
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
  maxDomainCandidates?: number;
  rules?: ClassificationRule[];
  rulesFile?: string;
}

export interface MailboxTargetResolution {
  requestedFolder: string;
  resolvedFolder: string;
  parentPath: string;
  strategy: "qqmail_classification_folder" | "explicit_classification_folder";
}

export type BulkGovernanceCategoryId =
  | "high_confidence_marketing"
  | "newsletter_or_digest"
  | "security_or_account"
  | "receipt_or_purchase"
  | "github_ci"
  | "github_pr_notification"
  | "github_code_review"
  | "github_account_security"
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

export interface EnsureClassificationFolderInput {
  runId: string;
  displayName: string;
  parentPath?: string;
}

export interface ClassificationFolderPreview {
  displayName: string;
  fullPath: string;
  exists: boolean;
  parentPath: string;
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
  mailboxSnapshot?: MailboxWindowSnapshot;
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

export interface ClassificationMapInput {
  folder: string;
  pageSize: number;
  maxPages: number;
  scanOffset?: number;
  order?: "newest" | "oldest";
}

export interface ClassificationSweepInput extends ClassificationMapInput {
  chunkPages?: number;
}

export type ClassificationMapAction =
  | "keep_for_account_history"
  | "archive_or_label"
  | "classify_to_folder"
  | "review";

export interface ClassificationMapBucket {
  categoryId: BulkGovernanceCategoryId;
  messageCount: number;
  recommendedAction: ClassificationMapAction;
  confidence: PriorityConfidence;
  reason: string;
  candidates: BulkGovernanceCandidate[];
}

export interface ClassificationMapReport {
  provider: string;
  folder: string;
  mailboxSnapshot?: MailboxWindowSnapshot;
  scanOrder: "newest" | "oldest";
  scanOffset: number;
  pageSize: number;
  maxPages: number;
  pagesScanned: number;
  scannedMessages: number;
  categoryCounts: Partial<Record<BulkGovernanceCategoryId, number>>;
  buckets: ClassificationMapBucket[];
  mutationsAttempted: 0;
}

export interface ClassificationSweepChunk {
  scanOffset: number;
  mailboxSnapshot?: MailboxWindowSnapshot;
  pagesScanned: number;
  scannedMessages: number;
  categoryCounts: Partial<Record<BulkGovernanceCategoryId, number>>;
}

export interface ClassificationSweepBucket {
  categoryId: BulkGovernanceCategoryId;
  messageCount: number;
  recommendedAction: ClassificationMapAction;
  confidence: PriorityConfidence;
  reason: string;
  candidateCount: number;
  topCandidates: Array<{
    domain: string;
    messageCount: number;
    confidence: PriorityConfidence;
    reason: string;
  }>;
}

export interface ClassificationSweepReport {
  provider: string;
  folder: string;
  scanOrder: "newest" | "oldest";
  scanOffset: number;
  pageSize: number;
  maxPages: number;
  chunkPages: number;
  pagesScanned: number;
  scannedMessages: number;
  complete: boolean;
  hasMore: boolean;
  nextScanOffset?: number;
  resumeToken?: { offset: number };
  categoryCounts: Partial<Record<BulkGovernanceCategoryId, number>>;
  buckets: ClassificationSweepBucket[];
  chunks: ClassificationSweepChunk[];
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
  candidateSummary: {
    totalDomainCandidates: number;
    returnedDomainCandidates: number;
    maxDomainCandidates: number;
    truncated: boolean;
  };
  targetResolution?: MailboxTargetResolution;
  serverBlocklistCapability: {
    supported: false;
    reason: string;
  };
  mutationsAttempted: 0;
}

export interface CleanupBatchPreview {
  provider: string;
  folder: string;
  mailboxSnapshot?: MailboxWindowSnapshot;
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
  selectedGroupTargets?: Record<string, { folder: string }>;
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
  ensureClassificationFolder(input: EnsureClassificationFolderInput): Promise<{
    folder: ClassificationFolderPreview;
    plan?: OperationPlan;
    mutationsAttempted: 0;
  }>;
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
  classificationMap(input: ClassificationMapInput): Promise<{
    map: ClassificationMapReport;
    mutationsAttempted: 0;
  }>;
  classificationSweep(input: ClassificationSweepInput): Promise<{
    sweep: ClassificationSweepReport;
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
      if (plan.action !== "move" && plan.action !== "create_folder") {
        throw new Error(`Unsupported execute_cleanup action: ${plan.action}`);
      }
      if (plan.action === "create_folder") {
        const targetFolder = plan.target?.folder;
        if (!targetFolder) {
          throw new Error("Create-folder execution requires target.folder");
        }
        if (!input.provider.createMailbox) {
          throw new Error("Provider does not implement createMailbox");
        }

        const createResult = await input.provider.createMailbox(targetFolder);
        return {
          result: {
            operationPlanId: plan.operationPlanId,
            status: "executed",
            action: plan.action,
            attemptedMessages: 0,
            mutationsAttempted: createResult.created ? 1 : 0,
            createdFolder: createResult.path,
          },
        };
      }
      const targetFolder = plan.target?.folder;
      if (!targetFolder) {
        throw new Error("Move execution requires target.folder");
      }
      if (!input.provider.moveMessages) {
        throw new Error("Provider does not implement moveMessages");
      }

      const executionLimit = normalizeMoveExecutionLimit(executeInput.maxMessages);
      const messageRefsToMove = executionLimit === undefined
        ? plan.messageRefs
        : plan.messageRefs.slice(0, executionLimit);
      const remainingMessages = plan.messageRefs.length - messageRefsToMove.length;
      const moveResult = input.provider.getMailboxSummary
        ? await moveMessagesWithFreshReconciliation(
            input.provider as MailProvider & { getMailboxSummary(folder: string): Promise<MailboxSummary> },
            messageRefsToMove,
            targetFolder,
          )
        : await input.provider.moveMessages(messageRefsToMove, targetFolder);
      return {
        result: {
          operationPlanId: plan.operationPlanId,
          status: remainingMessages > 0 ? "partially_executed" : "executed",
          action: plan.action,
          attemptedMessages: messageRefsToMove.length,
          mutationsAttempted: messageRefsToMove.length,
          moved: moveResult.moved,
          totalPlanMessages: plan.messageRefs.length,
          remainingMessages,
          ...(executionLimit === undefined
            ? {}
            : { executionBatch: { requestedMaxMessages: executionLimit, executedMessages: messageRefsToMove.length } }),
          reconciliations: moveResult.reconciliations,
        },
      };
    },

    async ensureClassificationFolder(folderInput) {
      const parentPath = folderInput.parentPath ?? DEFAULT_CLASSIFICATION_PARENT_PATH;
      const displayName = normalizeFolderDisplayName(folderInput.displayName);
      const fullPath = joinMailboxPath(parentPath, displayName);
      const mailboxes = await input.provider.listMailboxes();
      const exists = mailboxes.some((mailbox) => mailbox.path === fullPath);
      const folder = {
        displayName,
        fullPath,
        exists,
        parentPath,
      };

      if (exists) {
        return {
          folder,
          mutationsAttempted: 0,
        };
      }

      const capability = input.provider.getCapabilitySnapshot
        ? await input.provider.getCapabilitySnapshot()
        : undefined;
      return {
        folder,
        plan: createOperationPlan({
          runId: folderInput.runId,
          provider: capability?.provider === "qqmail" ? "qqmail" : "fixture",
          action: "create_folder",
          messageRefs: [],
          target: {
            folder: fullPath,
            displayName,
            parentPath,
          },
        }),
        mutationsAttempted: 0,
      };
    },

    async planCleanup(planInput) {
      if (planInput.messageRefs && planInput.messageRefs.length > 0) {
        if (planInput.messageRefs.length > CLIENT_REFS_PLAN_LIMIT) {
          throw new Error(`client_refs cleanup plans are limited to ${CLIENT_REFS_PLAN_LIMIT} message refs`);
        }
        const provider = planInput.messageRefs[0]?.provider ?? input.runtimeConfig?.provider ?? "fixture";
        const targetResolution = resolveOperationTarget({
          provider,
          action: planInput.action,
          target: planInput.target,
        });
        return {
          plan: createOperationPlan({
            runId: planInput.runId,
            provider,
            action: planInput.action,
            messageRefs: planInput.messageRefs,
            target: targetResolution.target,
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
      const provider = selectedRefs[0]?.provider ?? messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";
      const targetResolution = resolveOperationTarget({
        provider,
        action: planInput.action,
        target: planInput.target,
      });

      return {
        plan: createOperationPlan({
          runId: planInput.runId,
          provider,
          action: planInput.action,
          messageRefs: selectedRefs,
          target: targetResolution.target,
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
      const scanWindow = await scanMetadataWindow(input.provider, {
        folder: batchInput.folder,
        limit: pageSize,
        maxPages,
        order: scanOrder,
        offset: scanOffset,
      });
      const messages = scanWindow.messages;
      const classifications = classifyMessages({
        messages,
        rules: resolvedRules.rules,
        defaultGroupId: resolvedRules.defaultGroupId,
      });

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
      const selectedGroupTargets = resolveSelectedGroupTargets(resolvedRules.groups, batchInput.selectedGroupIds);
      const target = batchInput.target ?? inferSingleSelectedTarget(selectedGroupTargets);
      const provider = selectedRefs[0]?.provider ?? messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";
      const targetResolution = resolveOperationTarget({
        provider,
        action: batchInput.action,
        target,
      });

      return {
        preview: {
          provider,
          folder: batchInput.folder,
          mailboxSnapshot: scanWindow.mailboxSnapshot,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: messages.length,
          selectedMessageRefs: selectedRefs.length,
          maxMessageRefs,
          groupCounts: countGroups(classifications),
          sampledMessages: messages.slice(0, Math.min(messages.length, 10)),
          selectedGroups,
          selectedGroupTargets,
          ruleset: resolvedRules.ruleset,
          mutationsAttempted: 0,
        },
        plan: createOperationPlan({
          runId: batchInput.runId,
          provider,
          action: batchInput.action,
          messageRefs: selectedRefs,
          target: targetResolution.target,
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
      const scanWindow = await scanMetadataWindow(input.provider, {
        folder: governanceInput.folder,
        limit: pageSize,
        maxPages,
        order: scanOrder,
        offset: scanOffset,
      });
      const messages = scanWindow.messages;

      const selectedSenderDomains = governanceInput.selectedSenderDomains ?? [];
      const selectedFromIncludes = governanceInput.selectedFromIncludes ?? [];
      const selectedRefs = messages
        .filter((message) => matchesSenderGovernanceSelection(message, selectedSenderDomains, selectedFromIncludes))
        .map((message) => message.ref)
        .slice(0, maxMessageRefs);
      const provider = selectedRefs[0]?.provider ?? messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";

      const allDomainCandidates = buildSenderGovernanceCandidates(messages);
      const maxDomainCandidates = Math.max(governanceInput.maxDomainCandidates ?? DEFAULT_SENDER_GOVERNANCE_CANDIDATE_LIMIT, 0);
      const domainCandidates = limitSenderGovernanceCandidates(
        allDomainCandidates,
        maxDomainCandidates,
        new Set(selectedSenderDomains),
      );
      const targetResolution = resolveOperationTarget({
        provider,
        action: governanceInput.action,
        target: governanceInput.target,
      });
      const rulesetPatch = buildRulesetPatchDraft({
        candidates: allDomainCandidates,
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
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: messages.length,
          selectedMessageRefs: selectedRefs.length,
          maxMessageRefs,
          domainCandidates,
          selectedSenderDomains,
          selectedFromIncludes,
          candidateSummary: {
            totalDomainCandidates: allDomainCandidates.length,
            returnedDomainCandidates: domainCandidates.length,
            maxDomainCandidates,
            truncated: domainCandidates.length < allDomainCandidates.length,
          },
          targetResolution: targetResolution.resolution,
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
          target: targetResolution.target,
        }),
        mutationsAttempted: 0,
      };
    },

    async classificationMap(mapInput) {
      const pageSize = Math.max(mapInput.pageSize, 0);
      const maxPages = Math.max(mapInput.maxPages, 0);
      const scanOffset = Math.max(mapInput.scanOffset ?? 0, 0);
      const scanOrder = mapInput.order ?? "oldest";
      const scanWindow = input.provider.scanMailboxMetadataWindow
        ? await input.provider.scanMailboxMetadataWindow({
          folder: mapInput.folder,
          limit: pageSize,
          maxPages,
          order: scanOrder,
          offset: scanOffset,
        })
        : await scanMetadataWindowWithPages(input.provider, {
          folder: mapInput.folder,
          limit: pageSize,
          maxPages,
          order: scanOrder,
          offset: scanOffset,
        });
      const messages = scanWindow.messages;
      const categorized = messages.map((message) => ({
        message,
        classification: classifyBulkGovernanceMessage(message),
      }));
      const categoryCounts = countBulkCategories(categorized.map((entry) => entry.classification.categoryId));
      const categoryCandidates = buildBulkGovernanceCandidates(categorized, new Set());

      return {
        map: {
          provider: messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture",
          folder: mapInput.folder,
          mailboxSnapshot: scanWindow.mailboxSnapshot,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: messages.length,
          categoryCounts,
          buckets: buildClassificationMapBuckets(categoryCounts, categoryCandidates),
          mutationsAttempted: 0,
        },
        mutationsAttempted: 0,
      };
    },

    async classificationSweep(sweepInput) {
      const pageSize = Math.max(sweepInput.pageSize, 0);
      const maxPages = Math.max(sweepInput.maxPages, 0);
      const chunkPages = Math.max(Math.min(sweepInput.chunkPages ?? 25, maxPages), 0);
      const scanOffset = Math.max(sweepInput.scanOffset ?? 0, 0);
      const scanOrder = sweepInput.order ?? "oldest";
      const chunks: ClassificationSweepChunk[] = [];
      const allCategorized: Array<{
        message: MessageSummary;
        classification: ReturnType<typeof classifyBulkGovernanceMessage>;
      }> = [];
      let pagesScanned = 0;
      let scannedMessages = 0;
      let currentOffset = scanOffset;
      let complete = false;

      while (pageSize > 0 && chunkPages > 0 && pagesScanned < maxPages) {
        const pagesRemaining = maxPages - pagesScanned;
        const currentChunkPages = Math.min(chunkPages, pagesRemaining);
        const scanWindow = input.provider.scanMailboxMetadataWindow
          ? await input.provider.scanMailboxMetadataWindow({
            folder: sweepInput.folder,
            limit: pageSize,
            maxPages: currentChunkPages,
            order: scanOrder,
            offset: currentOffset,
          })
          : await scanMetadataWindowWithPages(input.provider, {
            folder: sweepInput.folder,
            limit: pageSize,
            maxPages: currentChunkPages,
            order: scanOrder,
            offset: currentOffset,
          });
        const categorized = scanWindow.messages.map((message) => ({
          message,
          classification: classifyBulkGovernanceMessage(message),
        }));
        const categoryCounts = countBulkCategories(categorized.map((entry) => entry.classification.categoryId));
        chunks.push({
          scanOffset: currentOffset,
          mailboxSnapshot: scanWindow.mailboxSnapshot,
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: scanWindow.messages.length,
          categoryCounts,
        });
        allCategorized.push(...categorized);
        pagesScanned += scanWindow.pagesScanned;
        scannedMessages += scanWindow.messages.length;
        currentOffset += scanWindow.messages.length;

        if (scanWindow.messages.length === 0 || scanWindow.pagesScanned < currentChunkPages) {
          complete = true;
          break;
        }
      }

      const categoryCounts = countBulkCategories(allCategorized.map((entry) => entry.classification.categoryId));
      const categoryCandidates = buildBulkGovernanceCandidates(allCategorized, new Set());
      const bucketSummaries = buildClassificationMapBuckets(categoryCounts, categoryCandidates).map((bucket) => ({
        categoryId: bucket.categoryId,
        messageCount: bucket.messageCount,
        recommendedAction: bucket.recommendedAction,
        confidence: bucket.confidence,
        reason: bucket.reason,
        candidateCount: bucket.candidates.length,
        topCandidates: bucket.candidates.slice(0, 5).map((candidate) => ({
          domain: candidate.domain,
          messageCount: candidate.messageCount,
          confidence: candidate.confidence,
          reason: candidate.reason,
        })),
      }));

      return {
        sweep: {
          provider: allCategorized[0]?.message.ref.provider ?? input.runtimeConfig?.provider ?? "fixture",
          folder: sweepInput.folder,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          chunkPages,
          pagesScanned,
          scannedMessages,
          complete,
          hasMore: !complete,
          nextScanOffset: complete ? undefined : currentOffset,
          resumeToken: complete ? undefined : { offset: currentOffset },
          categoryCounts,
          buckets: bucketSummaries,
          chunks,
          mutationsAttempted: 0,
        },
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
      const targetResolution = resolveOperationTarget({
        provider,
        action: bulkInput.action,
        target: bulkInput.target,
      });

      return {
        preview: {
          provider,
          folder: bulkInput.folder,
          mailboxSnapshot: scanWindow.mailboxSnapshot,
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
          target: targetResolution.target,
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
): Promise<ScanMailboxMetadataWindowResult> {
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
  }
  return { messages, pagesScanned };
}

async function scanMetadataWindow(
  provider: MailProvider,
  input: {
    folder: string;
    limit: number;
    maxPages: number;
    order: "newest" | "oldest";
    offset: number;
  },
): Promise<ScanMailboxMetadataWindowResult> {
  if (provider.scanMailboxMetadataWindow) {
    return provider.scanMailboxMetadataWindow(input);
  }
  const result = await scanMetadataWindowWithPages(provider, input);
  const mailboxSummary = provider.getMailboxSummary
    ? await provider.getMailboxSummary(input.folder)
    : undefined;
  return {
    ...result,
    mailboxSnapshot: mailboxSummary
      ? {
        folder: mailboxSummary.path,
        exists: mailboxSummary.exists,
        uidValidity: mailboxSummary.uidValidity,
      }
      : undefined,
  };
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
      nextAction: "classify to a folder or add a rule after review",
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

function limitSenderGovernanceCandidates(
  candidates: SenderGovernanceCandidate[],
  maxCandidates: number,
  selectedDomains: Set<string>,
): SenderGovernanceCandidate[] {
  if (maxCandidates <= 0) {
    return candidates.filter((candidate) => selectedDomains.has(candidate.domain));
  }
  const selected = candidates.filter((candidate) => selectedDomains.has(candidate.domain));
  const selectedKeys = new Set(selected.map((candidate) => candidate.domain));
  if (selected.length >= maxCandidates) {
    return selected;
  }
  const remaining = candidates.filter((candidate) => !selectedKeys.has(candidate.domain));
  return [...selected, ...remaining].slice(0, maxCandidates);
}

function resolveOperationTarget(input: {
  provider: string;
  action: OperationAction;
  target?: Record<string, string>;
}): { target?: Record<string, string>; resolution?: MailboxTargetResolution } {
  if (!input.target || input.action !== "move") {
    return { target: input.target };
  }
  const requestedFolder = input.target.folder?.trim();
  if (!requestedFolder || requestedFolder.includes("/") || input.target.folderMode === "literal") {
    return { target: input.target };
  }

  const explicitClassification = input.target.displayName || input.target.parentPath;
  if (input.provider !== "qqmail" && !explicitClassification) {
    return { target: input.target };
  }

  const parentPath = input.target.parentPath ?? DEFAULT_CLASSIFICATION_PARENT_PATH;
  const displayName = normalizeFolderDisplayName(input.target.displayName ?? requestedFolder);
  const resolvedFolder = joinMailboxPath(parentPath, displayName);
  const resolution: MailboxTargetResolution = {
    requestedFolder,
    resolvedFolder,
    parentPath,
    strategy: input.provider === "qqmail" ? "qqmail_classification_folder" : "explicit_classification_folder",
  };
  return {
    target: {
      ...input.target,
      folder: resolvedFolder,
      requestedFolder,
      targetResolution: resolution.strategy,
    },
    resolution,
  };
}

function classifyBulkGovernanceMessage(message: MessageSummary): {
  categoryId: BulkGovernanceCategoryId;
  confidence: PriorityConfidence;
  reason: string;
} {
  const domain = extractSenderDomain(message.from);
  const text = `${message.from}\n${message.subject}\n${message.snippet}`.toLocaleLowerCase();

  if (domain === "github.com") {
    const githubCategory = classifyGithubNotification(text);
    if (githubCategory) return githubCategory;
  }

  if (hasAny(text, [
    "安全代码",
    "security code",
    "security alert",
    "异常登录",
    "新登录",
    "登录通知",
    "login attempt",
    "new sign-in",
    "verify your email",
    "验证码",
    "验证",
    "校验",
    "找回密码",
    "密码重置",
    "密码已更改",
    "绑定成功",
    "account",
    "帐户",
  ])) {
    return { categoryId: "security_or_account", confidence: "high", reason: "metadata indicates account, login, verification, or security mail" };
  }

  if (hasAny(text, ["购买", "receipt", "invoice", "账单", "订单", "payment", "支付", "subscription", "收据", "凭证"])) {
    return { categoryId: "receipt_or_purchase", confidence: "high", reason: "metadata indicates a receipt, purchase, payment, or subscription" };
  }

  if (hasAny(domain, ["dlsite.com", "mail.nikke-official.com", "wargaming.net", "postermaster.sony.com.cn"])
    || (hasAny(domain, ["epicgames.com"]) && hasAny(text, ["sale", "off", "free", "discount", "特卖", "优惠"]))
    || hasAny(text, ["广告", "(ad)", "优惠", "促销", "特卖", "礼物已到位", "登录游戏即可", "promotion", "promo", "campaign"])) {
    return { categoryId: "high_confidence_marketing", confidence: "high", reason: "metadata matches known marketing sender or promotion subject pattern" };
  }

  if (hasAny(domain, ["github.com", "codeforces.com", "gitee.com", "oschina.net", "edmsend.csdn.net", "hyperskill.org", "openrouter.ai", "mail.trae.ai", "system.trae.ai"])
    || hasAny(text, ["codeforces round", "pull request", "issue", "commit"])) {
    return { categoryId: "developer_community", confidence: "medium", reason: "metadata indicates developer community or repository activity" };
  }

  if (hasAny(domain, ["e-mail.microsoft.com", "e-mails.microsoft.com", "email2.office.com", "notificationemails.microsoft.com", "worldcommunitygrid.org"])
    || hasAny(text, ["windows insider", "preview build", "newsletter", "digest", "unsubscribe", "退订", "周报", "月报"])) {
    return { categoryId: "newsletter_or_digest", confidence: "medium", reason: "metadata indicates newsletter, digest, or unsubscribe-capable bulk mail" };
  }

  return { categoryId: "review", confidence: "low", reason: "no high-confidence bulk governance category matched" };
}

function classifyGithubNotification(text: string): {
  categoryId: BulkGovernanceCategoryId;
  confidence: PriorityConfidence;
  reason: string;
} | undefined {
  if (hasAny(text, [
    "security alert",
    "new sign-in",
    "new sign in",
    "two-factor",
    "2fa",
    "verification",
    "verify your",
    "password",
    "recovery",
    "personal access token",
    "oauth",
    "github account",
  ])) {
    return {
      categoryId: "github_account_security",
      confidence: "high",
      reason: "metadata indicates GitHub account, login, token, or security mail",
    };
  }

  if (hasAny(text, [
    "pr run failed",
    "run failed",
    "workflow run",
    "workflow failed",
    "workflow succeeded",
    "check run",
    "checks failed",
    "build failed",
    "build succeeded",
    "deployment failed",
    "deployment succeeded",
    "ci",
  ])) {
    return {
      categoryId: "github_ci",
      confidence: "high",
      reason: "metadata indicates GitHub CI, workflow, check, build, or deployment result",
    };
  }

  if (hasAny(text, [
    "claude code review",
    "qodo-code-review",
    "qodo code review",
    "sourcery",
    "coderabbit",
    "code review",
    "review requested",
    "review required",
    "review comments",
  ])) {
    return {
      categoryId: "github_code_review",
      confidence: "high",
      reason: "metadata indicates GitHub code review or review bot activity",
    };
  }

  if (hasAny(text, [
    "pull request",
    "pr #",
    "(pr #",
    "merged",
    "closed",
    "opened",
    "assigned",
  ])) {
    return {
      categoryId: "github_pr_notification",
      confidence: "medium",
      reason: "metadata indicates GitHub pull request lifecycle notification",
    };
  }

  return {
    categoryId: "developer_community",
    confidence: "medium",
    reason: "metadata indicates GitHub repository activity",
  };
}

function countBulkCategories(categoryIds: BulkGovernanceCategoryId[]): Partial<Record<BulkGovernanceCategoryId, number>> {
  const counts: Partial<Record<BulkGovernanceCategoryId, number>> = {};
  for (const categoryId of categoryIds) {
    counts[categoryId] = (counts[categoryId] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildClassificationMapBuckets(
  categoryCounts: Partial<Record<BulkGovernanceCategoryId, number>>,
  categoryCandidates: Partial<Record<BulkGovernanceCategoryId, BulkGovernanceCandidate[]>>,
): ClassificationMapBucket[] {
  const categoryOrder: BulkGovernanceCategoryId[] = [
    "security_or_account",
    "receipt_or_purchase",
    "github_account_security",
    "github_code_review",
    "github_ci",
    "github_pr_notification",
    "developer_community",
    "newsletter_or_digest",
    "high_confidence_marketing",
    "review",
  ];
  return categoryOrder
    .map((categoryId) => {
      const candidates = categoryCandidates[categoryId] ?? [];
      const messageCount = categoryCounts[categoryId] ?? 0;
      return {
        categoryId,
        messageCount,
        recommendedAction: recommendedClassificationMapAction(categoryId),
        confidence: highestConfidence(candidates.map((candidate) => candidate.confidence)),
        reason: classificationMapReason(categoryId),
        candidates,
      };
    })
    .filter((bucket) => bucket.messageCount > 0);
}

function recommendedClassificationMapAction(categoryId: BulkGovernanceCategoryId): ClassificationMapAction {
  if (categoryId === "security_or_account" || categoryId === "receipt_or_purchase" || categoryId === "github_account_security") {
    return "keep_for_account_history";
  }
  if (categoryId === "high_confidence_marketing") return "classify_to_folder";
  if (categoryId === "developer_community"
    || categoryId === "newsletter_or_digest"
    || categoryId === "github_ci"
    || categoryId === "github_pr_notification"
    || categoryId === "github_code_review") return "archive_or_label";
  return "review";
}

function classificationMapReason(categoryId: BulkGovernanceCategoryId): string {
  if (categoryId === "security_or_account") {
    return "Account, login, verification, and security mail should be preserved before cleanup.";
  }
  if (categoryId === "receipt_or_purchase") {
    return "Receipts, purchases, payments, and subscriptions are account history, not disposable ads.";
  }
  if (categoryId === "github_account_security") {
    return "GitHub account, login, and security notifications should be preserved separately from repository noise.";
  }
  if (categoryId === "github_code_review") {
    return "GitHub code review bot and reviewer messages are useful but should be separated from generic repository notifications.";
  }
  if (categoryId === "github_ci") {
    return "GitHub workflow, check, and CI result notifications should be grouped for build-history review.";
  }
  if (categoryId === "github_pr_notification") {
    return "GitHub pull request lifecycle notifications should be grouped separately from CI and review bots.";
  }
  if (categoryId === "high_confidence_marketing") {
    return "Known marketing senders or promotion subjects can be reviewed as a bucket before moving to a marketing folder.";
  }
  if (categoryId === "newsletter_or_digest") {
    return "Newsletters and digests are better archived or labeled after sender-level review.";
  }
  if (categoryId === "developer_community") {
    return "Developer community notifications usually need archive or label treatment instead of junk.";
  }
  return "Messages without a strong category match need manual review before any batch action.";
}

function resolveSelectedGroupTargets(
  groups: ClassificationGroup[] | undefined,
  selectedGroupIds: string[],
): Record<string, { folder: string }> | undefined {
  if (!groups) return undefined;
  const selected = new Set(selectedGroupIds);
  const targets: Record<string, { folder: string }> = {};
  for (const group of groups) {
    if (selected.has(group.id) && group.target?.folder) {
      targets[group.id] = { folder: group.target.folder };
    }
  }
  return Object.keys(targets).length > 0 ? targets : undefined;
}

function inferSingleSelectedTarget(
  selectedGroupTargets: Record<string, { folder: string }> | undefined,
): { folder: string } | undefined {
  if (!selectedGroupTargets) return undefined;
  const targets = Object.values(selectedGroupTargets);
  return targets.length === 1 ? targets[0] : undefined;
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

function normalizeMoveExecutionLimit(maxMessages: number | undefined): number | undefined {
  if (maxMessages === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(maxMessages) || maxMessages <= 0) {
    throw new Error(`maxMessages must be a positive integer, got ${maxMessages}`);
  }
  return maxMessages;
}

async function moveMessagesWithFreshReconciliation(
  provider: MailProvider & { getMailboxSummary(folder: string): Promise<MailboxSummary> },
  refs: MessageRef[],
  targetFolder: string,
): Promise<{ moved: number; reconciliations: MoveMessagesReconciliation[] }> {
  let moved = 0;
  const reconciliations: MoveMessagesReconciliation[] = [];
  for (const [sourceFolder, folderRefs] of groupMessageRefsByFolder(refs)) {
    const sourceBefore = await provider.getMailboxSummary(sourceFolder);
    const targetBefore = await provider.getMailboxSummary(targetFolder);
    const result = await provider.moveMessages?.(folderRefs, targetFolder);
    if (!result || result.moved !== folderRefs.length) {
      throw new Error(`QQ IMAP batch move failed for ${sourceFolder}: expected ${folderRefs.length}, got ${result?.moved ?? 0}`);
    }
    const reconciliation = await waitForFreshReconciliation({
      provider,
      sourceFolder,
      targetFolder,
      sourceBefore: sourceBefore.exists,
      targetBefore: targetBefore.exists,
      expectedSourceDelta: -folderRefs.length,
      expectedTargetDelta: folderRefs.length,
    });
    reconciliations.push(reconciliation);
    moved += folderRefs.length;
  }
  return { moved, reconciliations };
}

function groupMessageRefsByFolder(refs: MessageRef[]): Map<string, MessageRef[]> {
  const grouped = new Map<string, MessageRef[]>();
  for (const ref of refs) {
    const folderRefs = grouped.get(ref.folder) ?? [];
    folderRefs.push(ref);
    grouped.set(ref.folder, folderRefs);
  }
  return grouped;
}

async function waitForFreshReconciliation(input: {
  provider: MailProvider & { getMailboxSummary(folder: string): Promise<MailboxSummary> };
  sourceFolder: string;
  targetFolder: string;
  sourceBefore: number;
  targetBefore: number;
  expectedSourceDelta: number;
  expectedTargetDelta: number;
}): Promise<MoveMessagesReconciliation> {
  let latest: MoveMessagesReconciliation | undefined;
  for (let attempt = 0; attempt < MOVE_RECONCILE_ATTEMPTS; attempt += 1) {
    const sourceAfter = await input.provider.getMailboxSummary(input.sourceFolder);
    const targetAfter = await input.provider.getMailboxSummary(input.targetFolder);
    latest = {
      sourceFolder: input.sourceFolder,
      targetFolder: input.targetFolder,
      sourceBefore: input.sourceBefore,
      sourceAfter: sourceAfter.exists,
      sourceDelta: sourceAfter.exists - input.sourceBefore,
      targetBefore: input.targetBefore,
      targetAfter: targetAfter.exists,
      targetDelta: targetAfter.exists - input.targetBefore,
      expectedSourceDelta: input.expectedSourceDelta,
      expectedTargetDelta: input.expectedTargetDelta,
      targetDeltaReconciled: targetAfter.exists - input.targetBefore === input.expectedTargetDelta,
      sourceDeltaReliable: sourceAfter.exists - input.sourceBefore === input.expectedSourceDelta,
      sourceDeltaStatus: sourceAfter.exists - input.sourceBefore === input.expectedSourceDelta
        ? "matched"
        : "concurrent_or_external_change",
    };
    if (isMoveReconciled(latest)) {
      return latest;
    }
    if (attempt < MOVE_RECONCILE_ATTEMPTS - 1) {
      await sleep(MOVE_RECONCILE_DELAY_MS);
    }
  }
  if (!latest) {
    throw new Error("QQ IMAP move reconciliation did not run");
  }
  assertMoveReconciled(latest);
  return latest;
}

function isMoveReconciled(reconciliation: MoveMessagesReconciliation): boolean {
  return reconciliation.targetDelta === reconciliation.expectedTargetDelta;
}

function assertMoveReconciled(reconciliation: MoveMessagesReconciliation): void {
  if (!isMoveReconciled(reconciliation)) {
    throw new Error(
      `QQ IMAP move reconciliation failed: source ${reconciliation.sourceFolder} delta ${reconciliation.sourceDelta}`
      + ` expected ${reconciliation.expectedSourceDelta}; target ${reconciliation.targetFolder} delta ${reconciliation.targetDelta}`
      + ` expected ${reconciliation.expectedTargetDelta}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveRules(input: {
  rules?: ClassificationRule[];
  defaultGroupId?: string;
  rulesFile?: string;
}): Promise<{
  rules: ClassificationRule[];
  defaultGroupId: string;
  groups?: ClassificationGroup[];
  ruleset?: ClassificationRulesetMetadata;
}> {
  if (input.rulesFile) {
    const ruleset = await loadClassificationRuleset(input.rulesFile);
    return {
      rules: ruleset.rules,
      defaultGroupId: input.defaultGroupId ?? ruleset.defaultGroupId,
      groups: ruleset.groups,
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

function normalizeFolderDisplayName(displayName: string): string {
  const normalized = displayName.trim().replace(/[\\/]+/g, "");
  if (!normalized) {
    throw new Error("Classification folder displayName is empty");
  }
  return normalized;
}

function joinMailboxPath(parentPath: string, displayName: string): string {
  const parent = parentPath.trim().replace(/\/+$/g, "");
  if (!parent) return displayName;
  return `${parent}/${displayName}`;
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle.toLocaleLowerCase()));
}

function extractSenderDomain(from: string): string {
  const match = from.match(/@([^>\s]+)/);
  return match?.[1] ?? "";
}
