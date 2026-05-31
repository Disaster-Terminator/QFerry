import { createHash } from "node:crypto";
import { classifyMessages, type ClassificationRule, type MessageClassification, type PriorityBucketId, type PriorityConfidence } from "../classification.js";
import { createOperationPlan, type MessageRef, type OperationAction, type OperationPlan } from "../operation-plan.js";
import type { MailboxInfo, MailboxSummary, MailProvider, MailboxWindowSnapshot, MessageDetail, MessageSummary, MoveMessagesReconciliation, ProviderCapabilitySnapshot, ScanMailboxMetadataWindowResult } from "../providers/types.js";
import { loadClassificationRuleset, type ClassificationGroup, type ClassificationRulesetMetadata } from "../ruleset.js";
import { formatRulesetPatchChangelog, renderRulesetPatchDraft, type RulesetPatchDraft } from "../ruleset-patch.js";
import type { QFerryRuntimeConfig } from "../runtime-config.js";
import { parseSearchQuery, type ParsedSearchQuery } from "../search-query.js";

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

export interface SearchMessagesResult {
  messages: MessageSummary[];
  parsedQuery?: ParsedSearchQuery;
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
  reconciliationStatus?: "matched" | "target_reconciled_source_unreliable" | "target_unreconciled" | "provider_result_unreliable" | "unavailable";
  totalPlanMessages?: number;
  remainingMessages?: number;
  executionBatch?: {
    requestedMaxMessages: number;
    executedMessages: number;
  };
  batchAudit?: MessageRefAuditSummary;
  reconciliations?: Array<{
    sourceFolder: string;
    targetFolder: string;
    sourceBefore: number;
    sourceAfter: number;
    sourceDelta: number;
    targetBefore: number;
    targetAfter: number;
    targetDelta: number;
    expectedSourceDelta?: number;
    expectedTargetDelta?: number;
    targetDeltaReconciled: boolean;
    sourceDeltaReliable: boolean;
    sourceDeltaStatus: "matched" | "concurrent_or_external_change";
    reconciliationStatus: "matched" | "target_reconciled_source_unreliable" | "target_unreconciled" | "provider_result_unreliable";
  }>;
  createdFolder?: string;
}

export interface MessageRefAuditSummary {
  count: number;
  digest: string;
  duplicateCount: number;
  folders: Array<{
    folder: string;
    count: number;
    uidValidity?: string;
    firstUid?: string;
    lastUid?: string;
    minUid?: string;
    maxUid?: string;
    digest: string;
  }>;
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
  ruleGroup?: ClassificationGroup;
  rules?: ClassificationRule[];
  rulesFile?: string;
}

export interface SenderBreakdownInput {
  folder: string;
  pageSize: number;
  maxPages: number;
  scanOffset?: number;
  order?: "newest" | "oldest";
  fromDomainIncludes?: string;
  fromIncludes?: string;
  maxSenderCandidates?: number;
  ruleGroup?: ClassificationGroup;
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

export interface RulesetGovernancePreviewInput {
  runId: string;
  folder: string;
  pageSize: number;
  maxPages: number;
  maxMessageRefsPerGroup: number;
  action: OperationAction;
  defaultGroupId?: string;
  rules?: ClassificationRule[];
  rulesFile?: string;
  selectedGroupIds?: string[];
  scanOffset?: number;
  order?: "newest" | "oldest";
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

export interface RulesetGovernanceGroupPlan {
  groupId: string;
  label: string;
  target: Record<string, string>;
  selectedMessageRefs: number;
  totalMatchedMessages: number;
  operationPlanId: string;
  runId: string;
  targetResolution?: MailboxTargetResolution;
  messageRefAudit: MessageRefAuditSummary;
}

export interface RulesetGovernanceSkippedGroup {
  groupId: string;
  label: string;
  totalMatchedMessages: number;
  reason: "missing_target_folder" | "no_matched_messages";
}

export interface RulesetGovernanceCampaignReport {
  scannedMessages: number;
  plannedMessages: number;
  unplannedMessages: number;
  coverageBasis: "scanned_window";
  coverageRatio: number;
  planCount: number;
  topUnplannedDomains: Array<{
    domain: string;
    messageCount: number;
  }>;
  topUnplannedSenders: Array<{
    sender: string;
    domain: string;
    messageCount: number;
    sampleSubjects: string[];
  }>;
  truncatedGroups: Array<{
    groupId: string;
    label: string;
    selectedMessageRefs: number;
    totalMatchedMessages: number;
  }>;
  nextAction: "confirm_plans" | "review_rules" | "no_action";
}

export interface RulesetGovernancePreview {
  provider: string;
  folder: string;
  mailboxSnapshot?: MailboxWindowSnapshot;
  scanOrder: "newest" | "oldest";
  scanOffset: number;
  pageSize: number;
  maxPages: number;
  pagesScanned: number;
  scannedMessages: number;
  maxMessageRefsPerGroup: number;
  selectedGroupIds: string[];
  groupCounts: Record<string, number>;
  groupPlans: RulesetGovernanceGroupPlan[];
  skippedGroups: RulesetGovernanceSkippedGroup[];
  campaignReport: RulesetGovernanceCampaignReport;
  ruleset?: ClassificationRulesetMetadata;
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

export interface HighYieldGovernanceInput {
  folder: string;
  pageSize: number;
  maxPages: number;
  order?: "newest" | "oldest";
  scanOffset?: number;
  minMessageCount?: number;
  maxCandidates?: number;
  maxDistinctSendersForDomainRule?: number;
  ruleGroup?: ClassificationGroup;
  rules?: ClassificationRule[];
  rulesFile?: string;
}

export interface HighYieldGovernanceCandidate {
  domain: string;
  messageCount: number;
  uniqueSenderCount: number;
  seenCount: number;
  unreadCount: number;
  firstDate: string;
  lastDate: string;
  sampleSubjects: string[];
  topSenders: Array<{
    sender: string;
    messageCount: number;
  }>;
  recommendedAction: "draft_domain_rule" | "break_down_sender";
  reason: string;
  suggestedRule?: ClassificationRule;
}

export interface HighYieldGovernancePlannerReport {
  provider: string;
  folder: string;
  scanOrder: "newest" | "oldest";
  scanOffset: number;
  pageSize: number;
  maxPages: number;
  pagesScanned: number;
  scannedMessages: number;
  minMessageCount: number;
  maxCandidates: number;
  maxDistinctSendersForDomainRule: number;
  candidates: HighYieldGovernanceCandidate[];
  candidateSummary: {
    totalDomainCandidates: number;
    returnedHighYieldCandidates: number;
    directRuleCandidates: number;
    mixedDomainCandidates: number;
    lowYieldDomainCandidates: number;
    truncated: boolean;
  };
  recommendedNextAction: "draft_rules" | "review_mixed_domains" | "stop_low_yield";
  mutationsAttempted: 0;
}

export interface MailboxGovernanceCampaignInput {
  folders: string[];
  pageSize: number;
  maxPagesPerFolder: number;
  order?: "newest" | "oldest";
  scanOffset?: number;
  minMessageCount?: number;
  maxCandidatesPerFolder?: number;
  maxDistinctSendersForDomainRule?: number;
  maxConcurrentFolders?: number;
  scopeDraftRulesToSourceFolder?: boolean;
  ruleGroup?: ClassificationGroup;
  rules?: ClassificationRule[];
  rulesFile?: string;
}

export interface MailboxGovernanceCampaignReport {
  provider: string;
  folders: string[];
  scanOrder: "newest" | "oldest";
  scanOffset: number;
  pageSize: number;
  maxPagesPerFolder: number;
  foldersScanned: number;
  scannedMessages: number;
  minMessageCount: number;
  maxCandidatesPerFolder: number;
  maxDistinctSendersForDomainRule: number;
  maxConcurrentFolders: number;
  scopeDraftRulesToSourceFolder: boolean;
  folderPlans: HighYieldGovernancePlannerReport[];
  folderSummary: {
    draftRuleFolders: number;
    mixedDomainFolders: number;
    stopLowYieldFolders: number;
  };
  recommendedNextAction: "draft_rules" | "review_mixed_domains" | "stop_low_yield";
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

export interface SenderBreakdownCandidate {
  sender: string;
  domain: string;
  messageCount: number;
  seenCount: number;
  unreadCount: number;
  firstDate: string;
  lastDate: string;
  sampleSubjects: string[];
  suggestedRule: ClassificationRule;
}

export interface SenderBreakdownReport {
  provider: string;
  folder: string;
  scanOrder: "newest" | "oldest";
  scanOffset: number;
  pageSize: number;
  maxPages: number;
  pagesScanned: number;
  scannedMessages: number;
  matchedMessages: number;
  fromDomainIncludes?: string;
  fromIncludes?: string;
  senderCandidates: SenderBreakdownCandidate[];
  candidateSummary: {
    totalSenderCandidates: number;
    returnedSenderCandidates: number;
    maxSenderCandidates: number;
    truncated: boolean;
  };
  mutationsAttempted: 0;
}

export interface MailTools {
  getStatus(): Promise<{
    status: QFerryRuntimeConfig;
  }>;
  listMailboxes(): Promise<{ mailboxes: MailboxInfo[] }>;
  getMailboxSummary(input: GetMailboxSummaryInput): Promise<{ mailbox: MailboxSummary }>;
  getCapabilitySnapshot(): Promise<{ capability: ProviderCapabilitySnapshot }>;
  search(input: SearchMessagesInput): Promise<SearchMessagesResult>;
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
  planHighYieldGovernance(input: HighYieldGovernanceInput): Promise<{
    planner: HighYieldGovernancePlannerReport;
    rulesetPatch: RulesetPatchDraft;
    mutationsAttempted: 0;
  }>;
  planMailboxGovernanceCampaign(input: MailboxGovernanceCampaignInput): Promise<{
    campaign: MailboxGovernanceCampaignReport;
    rulesetPatch: RulesetPatchDraft;
    mutationsAttempted: 0;
  }>;
  senderBreakdown(input: SenderBreakdownInput): Promise<{
    breakdown: SenderBreakdownReport;
    mutationsAttempted: 0;
  }>;
  bulkGovernancePreview(input: BulkGovernancePreviewInput): Promise<{
    preview: BulkGovernancePreview;
    plan: OperationPlan;
    mutationsAttempted: 0;
  }>;
  rulesetGovernancePreview(input: RulesetGovernancePreviewInput): Promise<{
    preview: RulesetGovernancePreview;
    plans: OperationPlan[];
    classifications: MessageClassification[];
    ruleset?: ClassificationRulesetMetadata;
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
  const classificationParentPath = resolveClassificationParentPath(input.runtimeConfig);
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
      const normalizedInput = normalizeSearchMessagesInput(searchInput);
      const messages = await input.provider.scanMailboxMetadata({
        folder: normalizedInput.folder,
        limit: normalizedInput.limit,
        order: normalizedInput.order,
        offset: normalizedInput.offset,
      });

      return {
        messages: messages.filter((message) => matchesSearchInput(message, normalizedInput)),
        ...(normalizedInput.parsedQuery ? { parsedQuery: normalizedInput.parsedQuery } : {}),
      };
    },

    async fetch(ref) {
      return { message: await input.provider.fetchMessage(ref) };
    },

    async classifyMessages(classifyInput) {
      const resolvedRules = await resolveRules(withRuntimeRulesFile(classifyInput, input.runtimeConfig));
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
      const resolvedRules = await resolveRules(withRuntimeRulesFile(triageInput, input.runtimeConfig));
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
      const resolvedRules = await resolveRules(withRuntimeRulesFile({
        ...candidateInput,
        defaultGroupId: "review",
      }, input.runtimeConfig));
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
      if (!capability.mutationActions.includes(plan.action)) {
        const warning = capability.moveSafetyWarning ? `: ${capability.moveSafetyWarning}` : "";
        throw new Error(`Provider does not support safe ${plan.action} mutation${warning}`);
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
      const moveResult = input.provider.getMailboxSummary
        ? await moveMessagesWithFreshReconciliation(
            input.provider as MailProvider & { getMailboxSummary(folder: string): Promise<MailboxSummary> },
            messageRefsToMove,
            targetFolder,
          )
        : await input.provider.moveMessages(messageRefsToMove, targetFolder);
      const remainingMessages = plan.messageRefs.length - messageRefsToMove.length;
      const reconciliationStatus = summarizeMoveReconciliationStatus(moveResult.reconciliations);
      return {
        result: {
          operationPlanId: plan.operationPlanId,
          status: reconciliationStatus === "target_reconciled_source_unreliable"
            ? "blocked"
            : remainingMessages > 0 ? "partially_executed" : "executed",
          action: plan.action,
          attemptedMessages: messageRefsToMove.length,
          mutationsAttempted: messageRefsToMove.length,
          moved: moveResult.moved,
          reconciliationStatus,
          totalPlanMessages: plan.messageRefs.length,
          remainingMessages,
          ...(executionLimit === undefined
            ? {}
            : { executionBatch: { requestedMaxMessages: executionLimit, executedMessages: moveResult.moved } }),
          batchAudit: summarizeMessageRefs(messageRefsToMove),
          reconciliations: moveResult.reconciliations,
        },
      };
    },

    async ensureClassificationFolder(folderInput) {
      const parentPath = folderInput.parentPath ?? classificationParentPath;
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
          classificationParentPath,
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

      const resolvedRules = await resolveRules(withRuntimeRulesFile({
        ...planInput,
        defaultGroupId: planInput.defaultGroupId ?? "review",
      }, input.runtimeConfig));
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
        classificationParentPath,
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
      const resolvedRules = await resolveRules(withRuntimeRulesFile({
        ...batchInput,
        defaultGroupId: batchInput.defaultGroupId ?? "review",
      }, input.runtimeConfig));
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
        classificationParentPath,
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

      const ruleGroup = governanceInput.ruleGroup ?? { id: "sender_governance", label: "Sender governance" };
      const allDomainCandidates = buildSenderGovernanceCandidates(messages, ruleGroup);
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
        classificationParentPath,
      });
      const rulesetPatch = buildRulesetPatchDraft({
        candidates: allDomainCandidates,
        selectedSenderDomains,
        selectedFromIncludes,
        existingRules,
        ruleGroup,
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

    async planHighYieldGovernance(plannerInput) {
      const resolvedInput = withRuntimeRulesFile(plannerInput, input.runtimeConfig);
      const existingRuleset = resolvedInput.rulesFile
        ? await loadClassificationRuleset(resolvedInput.rulesFile)
        : undefined;
      const existingRules = existingRuleset?.rules ?? resolvedInput.rules ?? [];
      const pageSize = Math.max(plannerInput.pageSize, 0);
      const maxPages = Math.max(plannerInput.maxPages, 0);
      const scanOffset = Math.max(plannerInput.scanOffset ?? 0, 0);
      const scanOrder = plannerInput.order ?? "oldest";
      const minMessageCount = Math.max(plannerInput.minMessageCount ?? 10, 1);
      const maxCandidates = Math.max(plannerInput.maxCandidates ?? DEFAULT_SENDER_GOVERNANCE_CANDIDATE_LIMIT, 0);
      const maxDistinctSendersForDomainRule = Math.max(plannerInput.maxDistinctSendersForDomainRule ?? 2, 1);
      const scanWindow = await scanMetadataWindow(input.provider, {
        folder: plannerInput.folder,
        limit: pageSize,
        maxPages,
        order: scanOrder,
        offset: scanOffset,
      });
      const messages = scanWindow.messages;
      const provider = messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";
      const ruleGroup = plannerInput.ruleGroup ?? { id: "sender_governance", label: "Sender governance" };
      const allCandidates = buildHighYieldGovernanceCandidates(messages, {
        minMessageCount,
        maxDistinctSendersForDomainRule,
        ruleGroup,
      });
      const allHighYieldCandidates = allCandidates.filter((candidate) => candidate.messageCount >= minMessageCount);
      const highYieldCandidates = allHighYieldCandidates.slice(0, maxCandidates);
      const directCandidates = highYieldCandidates.filter((candidate) => candidate.recommendedAction === "draft_domain_rule");
      const mixedDomainCandidates = highYieldCandidates.filter((candidate) => candidate.recommendedAction === "break_down_sender");
      const rulesetPatch = buildRulesetPatchDraft({
        candidates: directCandidates.map((candidate) => ({
          domain: candidate.domain,
          messageCount: candidate.messageCount,
          seenCount: candidate.seenCount,
          unreadCount: candidate.unreadCount,
          firstDate: candidate.firstDate,
          lastDate: candidate.lastDate,
          sampleSubjects: candidate.sampleSubjects,
          senders: candidate.topSenders.map((sender) => sender.sender),
          suggestedRule: candidate.suggestedRule!,
        })),
        selectedSenderDomains: directCandidates.map((candidate) => candidate.domain),
        selectedFromIncludes: [],
        existingRules,
        ruleGroup,
        ruleset: existingRuleset?.metadata,
      });
      const renderedDraft = renderRulesetPatchDraft(rulesetPatch, existingRuleset);
      const changelog = formatRulesetPatchChangelog(rulesetPatch);
      const lowYieldDomainCandidates = allCandidates.length - allHighYieldCandidates.length;
      const recommendedNextAction = directCandidates.length > 0
        ? mixedDomainCandidates.length > 0 ? "review_mixed_domains" : "draft_rules"
        : mixedDomainCandidates.length > 0 ? "review_mixed_domains" : "stop_low_yield";

      return {
        planner: {
          provider,
          folder: plannerInput.folder,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: messages.length,
          minMessageCount,
          maxCandidates,
          maxDistinctSendersForDomainRule,
          candidates: highYieldCandidates,
          candidateSummary: {
            totalDomainCandidates: allCandidates.length,
            returnedHighYieldCandidates: highYieldCandidates.length,
            directRuleCandidates: directCandidates.length,
            mixedDomainCandidates: mixedDomainCandidates.length,
            lowYieldDomainCandidates,
            truncated: allHighYieldCandidates.length > highYieldCandidates.length,
          },
          recommendedNextAction,
          mutationsAttempted: 0,
        },
        rulesetPatch: {
          ...rulesetPatch,
          renderedDraft,
          changelog,
        },
        mutationsAttempted: 0,
      };
    },

    async planMailboxGovernanceCampaign(campaignInput) {
      const resolvedInput = withRuntimeRulesFile(campaignInput, input.runtimeConfig);
      const existingRuleset = resolvedInput.rulesFile
        ? await loadClassificationRuleset(resolvedInput.rulesFile)
        : undefined;
      const existingRules = existingRuleset?.rules ?? resolvedInput.rules ?? [];
      const pageSize = Math.max(campaignInput.pageSize, 0);
      const maxPagesPerFolder = Math.max(campaignInput.maxPagesPerFolder, 0);
      const scanOffset = Math.max(campaignInput.scanOffset ?? 0, 0);
      const scanOrder = campaignInput.order ?? "oldest";
      const minMessageCount = Math.max(campaignInput.minMessageCount ?? 10, 1);
      const maxCandidatesPerFolder = Math.max(campaignInput.maxCandidatesPerFolder ?? DEFAULT_SENDER_GOVERNANCE_CANDIDATE_LIMIT, 0);
      const maxDistinctSendersForDomainRule = Math.max(campaignInput.maxDistinctSendersForDomainRule ?? 2, 1);
      const maxConcurrentFolders = Math.min(Math.max(campaignInput.maxConcurrentFolders ?? 3, 1), 10);
      const scopeDraftRulesToSourceFolder = campaignInput.scopeDraftRulesToSourceFolder ?? true;
      const ruleGroup = campaignInput.ruleGroup ?? { id: "sender_governance", label: "Sender governance" };
      const plannedFolders = await mapWithConcurrency(campaignInput.folders, maxConcurrentFolders, async (folder) => {
        const scanWindow = await scanMetadataWindow(input.provider, {
          folder,
          limit: pageSize,
          maxPages: maxPagesPerFolder,
          order: scanOrder,
          offset: scanOffset,
        });
        const messages = scanWindow.messages;
        const folderProvider = messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";
        const allCandidates = buildHighYieldGovernanceCandidates(messages, {
          minMessageCount,
          maxDistinctSendersForDomainRule,
          ruleGroup,
        });
        const allHighYieldCandidates = allCandidates.filter((candidate) => candidate.messageCount >= minMessageCount);
        const highYieldCandidates = allHighYieldCandidates.slice(0, maxCandidatesPerFolder).map((candidate) => (
          scopeDraftRulesToSourceFolder && candidate.suggestedRule
            ? {
                ...candidate,
                suggestedRule: scopeDraftRuleToSourceFolder(candidate.suggestedRule, folder),
              }
            : candidate
        ));
        const directCandidates = highYieldCandidates.filter((candidate) => candidate.recommendedAction === "draft_domain_rule");
        const mixedDomainCandidates = highYieldCandidates.filter((candidate) => candidate.recommendedAction === "break_down_sender");
        const lowYieldDomainCandidates = allCandidates.length - allHighYieldCandidates.length;
        const recommendedNextAction = directCandidates.length > 0
          ? mixedDomainCandidates.length > 0 ? "review_mixed_domains" : "draft_rules"
          : mixedDomainCandidates.length > 0 ? "review_mixed_domains" : "stop_low_yield";

        const plan: HighYieldGovernancePlannerReport = {
          provider: folderProvider,
          folder,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages: maxPagesPerFolder,
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: messages.length,
          minMessageCount,
          maxCandidates: maxCandidatesPerFolder,
          maxDistinctSendersForDomainRule,
          candidates: highYieldCandidates,
          candidateSummary: {
            totalDomainCandidates: allCandidates.length,
            returnedHighYieldCandidates: highYieldCandidates.length,
            directRuleCandidates: directCandidates.length,
            mixedDomainCandidates: mixedDomainCandidates.length,
            lowYieldDomainCandidates,
            truncated: allHighYieldCandidates.length > highYieldCandidates.length,
          },
          recommendedNextAction,
          mutationsAttempted: 0,
        };

        return { plan, directCandidates };
      });
      const folderPlans = plannedFolders.map((folder) => folder.plan);
      const directCandidateByDomain = new Map<string, SenderGovernanceCandidate>();
      const provider = folderPlans.find((plan) => plan.provider)?.provider ?? input.runtimeConfig?.provider ?? "fixture";
      for (const { plan, directCandidates } of plannedFolders) {
        for (const candidate of directCandidates) {
          const candidateKey = scopeDraftRulesToSourceFolder ? `${plan.folder}\0${candidate.domain}` : candidate.domain;
          if (directCandidateByDomain.has(candidateKey)) continue;
          directCandidateByDomain.set(candidateKey, {
            domain: candidate.domain,
            messageCount: candidate.messageCount,
            seenCount: candidate.seenCount,
            unreadCount: candidate.unreadCount,
            firstDate: candidate.firstDate,
            lastDate: candidate.lastDate,
            sampleSubjects: candidate.sampleSubjects,
            senders: candidate.topSenders.map((sender) => sender.sender),
            suggestedRule: candidate.suggestedRule!,
          });
        }
      }

      const sortedFolderPlans = folderPlans.sort((left, right) =>
        folderActionRank(left.recommendedNextAction) - folderActionRank(right.recommendedNextAction)
        || folderPlannedMessageCount(right) - folderPlannedMessageCount(left)
        || left.folder.localeCompare(right.folder)
      );
      const draftRuleFolders = folderPlans.filter((plan) => plan.candidateSummary.directRuleCandidates > 0).length;
      const mixedDomainFolders = folderPlans.filter((plan) => plan.candidateSummary.directRuleCandidates === 0 && plan.candidateSummary.mixedDomainCandidates > 0).length;
      const stopLowYieldFolders = folderPlans.filter((plan) => plan.recommendedNextAction === "stop_low_yield").length;
      const rulesetPatch = buildRulesetPatchDraft({
        candidates: [...directCandidateByDomain.values()],
        selectedSenderDomains: [...directCandidateByDomain.values()].map((candidate) => candidate.domain),
        selectedFromIncludes: [],
        existingRules,
        ruleGroup,
        ruleset: existingRuleset?.metadata,
      });
      const renderedDraft = renderRulesetPatchDraft(rulesetPatch, existingRuleset);
      const changelog = formatRulesetPatchChangelog(rulesetPatch);
      const recommendedNextAction = draftRuleFolders > 0
        ? "draft_rules"
        : mixedDomainFolders > 0 ? "review_mixed_domains" : "stop_low_yield";

      return {
        campaign: {
          provider,
          folders: campaignInput.folders,
          scanOrder,
          scanOffset,
          pageSize,
          maxPagesPerFolder,
          foldersScanned: folderPlans.length,
          scannedMessages: folderPlans.reduce((sum, plan) => sum + plan.scannedMessages, 0),
          minMessageCount,
          maxCandidatesPerFolder,
          maxDistinctSendersForDomainRule,
          maxConcurrentFolders,
          scopeDraftRulesToSourceFolder,
          folderPlans: sortedFolderPlans,
          folderSummary: {
            draftRuleFolders,
            mixedDomainFolders,
            stopLowYieldFolders,
          },
          recommendedNextAction,
          mutationsAttempted: 0,
        },
        rulesetPatch: {
          ...rulesetPatch,
          renderedDraft,
          changelog,
        },
        mutationsAttempted: 0,
      };
    },

    async senderBreakdown(breakdownInput) {
      const pageSize = Math.max(breakdownInput.pageSize, 0);
      const maxPages = Math.max(breakdownInput.maxPages, 0);
      const scanOffset = Math.max(breakdownInput.scanOffset ?? 0, 0);
      const scanOrder = breakdownInput.order ?? "oldest";
      const maxSenderCandidates = Math.max(
        breakdownInput.maxSenderCandidates ?? DEFAULT_SENDER_GOVERNANCE_CANDIDATE_LIMIT,
        0,
      );
      const scanWindow = await scanMetadataWindow(input.provider, {
        folder: breakdownInput.folder,
        limit: pageSize,
        maxPages,
        order: scanOrder,
        offset: scanOffset,
      });
      const messages = scanWindow.messages;
      const matchedMessages = messages.filter((message) => {
        const domain = extractSenderDomain(message.from);
        return (!breakdownInput.fromDomainIncludes || includesIgnoreCase(domain, breakdownInput.fromDomainIncludes))
          && (!breakdownInput.fromIncludes || includesIgnoreCase(message.from, breakdownInput.fromIncludes));
      });
      const ruleGroup = breakdownInput.ruleGroup ?? { id: "sender_governance", label: "Sender governance" };
      const allSenderCandidates = buildSenderBreakdownCandidates(matchedMessages, ruleGroup);
      const senderCandidates = limitSenderBreakdownCandidates(allSenderCandidates, maxSenderCandidates);
      const provider = matchedMessages[0]?.ref.provider ?? messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";

      return {
        breakdown: {
          provider,
          folder: breakdownInput.folder,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: messages.length,
          matchedMessages: matchedMessages.length,
          fromDomainIncludes: breakdownInput.fromDomainIncludes,
          fromIncludes: breakdownInput.fromIncludes,
          senderCandidates,
          candidateSummary: {
            totalSenderCandidates: allSenderCandidates.length,
            returnedSenderCandidates: senderCandidates.length,
            maxSenderCandidates,
            truncated: senderCandidates.length < allSenderCandidates.length,
          },
          mutationsAttempted: 0,
        },
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
        classificationParentPath,
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

    async rulesetGovernancePreview(rulesetInput) {
      const resolvedRules = await resolveRules(withRuntimeRulesFile({
        ...rulesetInput,
        defaultGroupId: rulesetInput.defaultGroupId,
      }, input.runtimeConfig));
      const pageSize = Math.max(rulesetInput.pageSize, 0);
      const maxPages = Math.max(rulesetInput.maxPages, 0);
      const maxMessageRefsPerGroup = Math.max(rulesetInput.maxMessageRefsPerGroup, 0);
      const scanOffset = Math.max(rulesetInput.scanOffset ?? 0, 0);
      const scanOrder = rulesetInput.order ?? "oldest";
      const scanWindow = await scanMetadataWindow(input.provider, {
        folder: rulesetInput.folder,
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
      const groupsById = new Map((resolvedRules.groups ?? []).map((group) => [group.id, group]));
      const selectedGroupIds = rulesetInput.selectedGroupIds ?? (resolvedRules.groups ?? [])
        .filter((group) => group.id !== resolvedRules.defaultGroupId && group.target?.folder)
        .map((group) => group.id);
      const provider = messages[0]?.ref.provider ?? input.runtimeConfig?.provider ?? "fixture";
      const plans: OperationPlan[] = [];
      const groupPlans: RulesetGovernanceGroupPlan[] = [];
      const skippedGroups: RulesetGovernanceSkippedGroup[] = [];
      const plannedRefKeys = new Set<string>();

      for (const groupId of selectedGroupIds) {
        const group = groupsById.get(groupId);
        const label = group?.label ?? groupId;
        const groupClassifications = classifications.filter((classification) => classification.groupId === groupId);
        const totalMatchedMessages = groupClassifications.length;

        if (totalMatchedMessages === 0) {
          skippedGroups.push({ groupId, label, totalMatchedMessages, reason: "no_matched_messages" });
          continue;
        }
        if (!group?.target?.folder) {
          skippedGroups.push({ groupId, label, totalMatchedMessages, reason: "missing_target_folder" });
          continue;
        }

        const targetResolution = resolveOperationTarget({
          provider,
          action: rulesetInput.action,
          target: group.target,
          classificationParentPath,
        });
        const messageRefs = groupClassifications
          .map((classification) => classification.messageRef)
          .slice(0, maxMessageRefsPerGroup);
        for (const messageRef of messageRefs) {
          plannedRefKeys.add(messageRefKey(messageRef));
        }
        const plan = createOperationPlan({
          runId: `${rulesetInput.runId}-${slugifyRuleId(groupId)}`,
          provider,
          action: rulesetInput.action,
          messageRefs,
          target: targetResolution.target,
          source: "rules_preview",
        });
        plans.push(plan);
        groupPlans.push({
          groupId,
          label,
          target: targetResolution.target ?? group.target,
          selectedMessageRefs: messageRefs.length,
          totalMatchedMessages,
          operationPlanId: plan.operationPlanId,
          runId: plan.runId,
          targetResolution: targetResolution.resolution,
          messageRefAudit: summarizeMessageRefs(messageRefs),
        });
      }

      return {
        preview: {
          provider,
          folder: rulesetInput.folder,
          mailboxSnapshot: scanWindow.mailboxSnapshot,
          scanOrder,
          scanOffset,
          pageSize,
          maxPages,
          pagesScanned: scanWindow.pagesScanned,
          scannedMessages: messages.length,
          maxMessageRefsPerGroup,
          selectedGroupIds,
          groupCounts: countGroups(classifications),
          groupPlans,
          skippedGroups,
          campaignReport: buildRulesetGovernanceCampaignReport({
            messages,
            groupPlans,
            skippedGroups,
            plannedRefKeys,
          }),
          ruleset: resolvedRules.ruleset,
          mutationsAttempted: 0,
        },
        plans,
        classifications,
        ruleset: resolvedRules.ruleset,
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

function withRuntimeRulesFile<T extends { rules?: ClassificationRule[]; rulesFile?: string }>(
  input: T,
  runtimeConfig: QFerryRuntimeConfig | undefined,
): T {
  if (input.rulesFile || input.rules?.length || !runtimeConfig?.rulesFile) return input;
  return {
    ...input,
    rulesFile: runtimeConfig.rulesFile,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(maxConcurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }));
  return results;
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

function buildRulesetGovernanceCampaignReport(input: {
  messages: MessageSummary[];
  groupPlans: RulesetGovernanceGroupPlan[];
  skippedGroups: RulesetGovernanceSkippedGroup[];
  plannedRefKeys: Set<string>;
}): RulesetGovernanceCampaignReport {
  const plannedMessages = input.groupPlans.reduce((sum, plan) => sum + plan.selectedMessageRefs, 0);
  const scannedMessages = input.messages.length;
  const unplannedMessages = Math.max(scannedMessages - plannedMessages, 0);
  const coverageRatio = scannedMessages === 0
    ? 0
    : Number((plannedMessages / scannedMessages).toFixed(3));
  const truncatedGroups = input.groupPlans
    .filter((plan) => plan.selectedMessageRefs < plan.totalMatchedMessages)
    .map((plan) => ({
      groupId: plan.groupId,
      label: plan.label,
      selectedMessageRefs: plan.selectedMessageRefs,
      totalMatchedMessages: plan.totalMatchedMessages,
    }));
  const topUnplannedDomains = summarizeTopUnplannedDomains(input.messages, input.plannedRefKeys);
  const topUnplannedSenders = summarizeTopUnplannedSenders(input.messages, input.plannedRefKeys);
  const nextAction = input.groupPlans.length === 0
    ? "no_action"
    : unplannedMessages > 0 || input.skippedGroups.some((group) => group.totalMatchedMessages > 0) || truncatedGroups.length > 0
      ? "review_rules"
      : "confirm_plans";

  return {
    scannedMessages,
    plannedMessages,
    unplannedMessages,
    coverageBasis: "scanned_window",
    coverageRatio,
    planCount: input.groupPlans.length,
    topUnplannedDomains,
    topUnplannedSenders,
    truncatedGroups,
    nextAction,
  };
}

function summarizeTopUnplannedDomains(
  messages: MessageSummary[],
  plannedRefKeys: Set<string>,
): Array<{ domain: string; messageCount: number }> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (plannedRefKeys.has(messageRefKey(message.ref))) continue;
    const domain = extractSenderDomain(message.from) || "<unknown>";
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, messageCount]) => ({ domain, messageCount }))
    .sort((left, right) => right.messageCount - left.messageCount || left.domain.localeCompare(right.domain))
    .slice(0, 10);
}

function summarizeTopUnplannedSenders(
  messages: MessageSummary[],
  plannedRefKeys: Set<string>,
): Array<{ sender: string; domain: string; messageCount: number; sampleSubjects: string[] }> {
  const bySender = new Map<string, MessageSummary[]>();
  for (const message of messages) {
    if (plannedRefKeys.has(messageRefKey(message.ref))) continue;
    const sender = message.from.trim();
    if (!sender) continue;
    bySender.set(sender, [...(bySender.get(sender) ?? []), message]);
  }
  return [...bySender.entries()]
    .map(([sender, senderMessages]) => {
      const lastDate = senderMessages.map((message) => message.date).sort().at(-1) ?? "";
      return {
        sender,
        domain: extractSenderDomain(sender) ?? "",
        messageCount: senderMessages.length,
        sampleSubjects: [...new Set(senderMessages.map((message) => message.subject).filter(Boolean))].slice(0, 3),
        lastDate,
      };
    })
    .sort((left, right) =>
      right.messageCount - left.messageCount
      || right.lastDate.localeCompare(left.lastDate)
      || left.sender.localeCompare(right.sender))
    .slice(0, 10)
    .map(({ lastDate: _lastDate, ...candidate }) => candidate);
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

function buildSenderGovernanceCandidates(
  messages: MessageSummary[],
  ruleGroup: ClassificationGroup = { id: "sender_governance", label: "Sender governance" },
): SenderGovernanceCandidate[] {
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
        groupId: ruleGroup.id,
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

function buildHighYieldGovernanceCandidates(
  messages: MessageSummary[],
  options: {
    minMessageCount: number;
    maxDistinctSendersForDomainRule: number;
    ruleGroup: ClassificationGroup;
  },
): HighYieldGovernanceCandidate[] {
  const byDomain = new Map<string, MessageSummary[]>();
  for (const message of messages) {
    const domain = extractSenderDomain(message.from);
    if (!domain) continue;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), message]);
  }

  return [...byDomain.entries()]
    .map(([domain, domainMessages]) => {
      const dates = domainMessages.map((message) => message.date).sort();
      const bySender = new Map<string, MessageSummary[]>();
      for (const message of domainMessages) {
        bySender.set(message.from, [...(bySender.get(message.from) ?? []), message]);
      }
      const topSenders = [...bySender.entries()]
        .map(([sender, senderMessages]) => ({ sender, messageCount: senderMessages.length }))
        .sort((left, right) => right.messageCount - left.messageCount || left.sender.localeCompare(right.sender))
        .slice(0, 5);
      const uniqueSenderCount = bySender.size;
      const sampleSubjects = [...new Set(domainMessages.map((message) => message.subject))].slice(0, 3);
      const suggestedRule: ClassificationRule | undefined = uniqueSenderCount <= options.maxDistinctSendersForDomainRule
        ? {
          id: `sender-domain-${slugifyRuleId(domain)}`,
          groupId: options.ruleGroup.id,
          match: { fromDomainIncludes: domain },
          priority: {
            bucketId: "bulk",
            reason: `Messages from ${domain} meet the high-yield governance threshold`,
            confidence: domainMessages.length >= options.minMessageCount ? "high" : "medium",
            weight: Math.min(100, 50 + domainMessages.length * 10),
            nextAction: "Apply as a local rule, then preview a ruleset-backed move plan",
          },
        }
        : undefined;

      return {
        domain,
        messageCount: domainMessages.length,
        uniqueSenderCount,
        seenCount: domainMessages.filter((message) => message.flags.includes("\\Seen")).length,
        unreadCount: domainMessages.filter((message) => !message.flags.includes("\\Seen")).length,
        firstDate: dates[0] ?? "",
        lastDate: dates[dates.length - 1] ?? "",
        sampleSubjects,
        topSenders,
        recommendedAction: suggestedRule
          ? "draft_domain_rule" as const
          : "break_down_sender" as const,
        reason: suggestedRule
          ? `Domain has ${domainMessages.length} messages and ${uniqueSenderCount} sender(s), so a domain rule is low risk.`
          : `Domain has ${domainMessages.length} messages but ${uniqueSenderCount} distinct senders; break it down before drafting rules.`,
        suggestedRule,
      };
    })
    .sort((left, right) =>
      right.messageCount - left.messageCount
      || left.recommendedAction.localeCompare(right.recommendedAction)
      || left.domain.localeCompare(right.domain)
    );
}

function folderActionRank(action: HighYieldGovernancePlannerReport["recommendedNextAction"]): number {
  if (action === "draft_rules") return 0;
  if (action === "review_mixed_domains") return 1;
  return 2;
}

function folderPlannedMessageCount(plan: HighYieldGovernancePlannerReport): number {
  return plan.candidates.reduce((sum, candidate) => sum + candidate.messageCount, 0);
}

function scopeDraftRuleToSourceFolder(rule: ClassificationRule, folder: string): ClassificationRule {
  return {
    ...rule,
    id: `${rule.id}-in-${scopedRuleIdSuffix(folder)}`,
    match: {
      ...rule.match,
      folderEquals: folder,
    },
  };
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

function buildSenderBreakdownCandidates(
  messages: MessageSummary[],
  ruleGroup: ClassificationGroup = { id: "sender_governance", label: "Sender governance" },
): SenderBreakdownCandidate[] {
  const bySender = new Map<string, MessageSummary[]>();
  for (const message of messages) {
    if (!message.from.trim()) continue;
    bySender.set(message.from, [...(bySender.get(message.from) ?? []), message]);
  }

  return [...bySender.entries()]
    .map(([sender, senderMessages]) => {
      const dates = senderMessages.map((message) => message.date).sort();
      const sampleSubjects = [...new Set(senderMessages.map((message) => message.subject))].slice(0, 5);
      return {
        sender,
        domain: extractSenderDomain(sender) ?? "",
        messageCount: senderMessages.length,
        seenCount: senderMessages.filter((message) => message.flags.includes("\\Seen")).length,
        unreadCount: senderMessages.filter((message) => !message.flags.includes("\\Seen")).length,
        firstDate: dates[0] ?? "",
        lastDate: dates[dates.length - 1] ?? "",
        sampleSubjects,
        suggestedRule: buildSenderRule(sender, ruleGroup.id),
      };
    })
    .sort((left, right) =>
      right.messageCount - left.messageCount
      || right.lastDate.localeCompare(left.lastDate)
      || left.sender.localeCompare(right.sender));
}

function limitSenderBreakdownCandidates(
  candidates: SenderBreakdownCandidate[],
  maxCandidates: number,
): SenderBreakdownCandidate[] {
  return maxCandidates <= 0 ? [] : candidates.slice(0, maxCandidates);
}

function resolveOperationTarget(input: {
  provider: string;
  action: OperationAction;
  target?: Record<string, string>;
  classificationParentPath?: string;
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

  const parentPath = input.target.parentPath ?? input.classificationParentPath ?? DEFAULT_CLASSIFICATION_PARENT_PATH;
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

function resolveClassificationParentPath(runtimeConfig: QFerryRuntimeConfig | undefined): string {
  return runtimeConfig?.qqmail?.classificationParentPath?.trim() || DEFAULT_CLASSIFICATION_PARENT_PATH;
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
    "账号安全",
    "master password",
    "multi-factor authentication",
    "mfa",
    "申诉",
  ])) {
    return { categoryId: "security_or_account", confidence: "high", reason: "metadata indicates account, login, verification, or security mail" };
  }
  if (hasAny(domain, [
    "authy.com",
    "bitwarden.com",
    "mongodb.com",
    "passport.xiaomi.com",
    "tm.openai.com",
  ])) {
    return { categoryId: "security_or_account", confidence: "high", reason: "metadata matches known account or security sender domain" };
  }
  if (domain === "google.com" && hasAny(text, ["申诉", "appeal", "forwarding", "转发确认"])) {
    return { categoryId: "security_or_account", confidence: "high", reason: "metadata matches Google account or forwarding notification" };
  }

  if (hasAny(text, ["购买", "receipt", "invoice", "账单", "订单", "payment", "支付", "subscription", "收据", "凭证"])) {
    return { categoryId: "receipt_or_purchase", confidence: "high", reason: "metadata indicates a receipt, purchase, payment, or subscription" };
  }

  if (hasAny(domain, [
    "best.wondershare.com",
    "blackmagic-design.com",
    "dlsite.com",
    "em1.cloudflare.com",
    "mail.nikke-official.com",
    "wargaming.net",
    "postermaster.sony.com.cn",
  ])
    || (hasAny(domain, ["epicgames.com"]) && hasAny(text, ["sale", "off", "free", "discount", "特卖", "优惠"]))
    || hasAny(text, ["广告", "(ad)", "优惠", "促销", "特卖", "礼物已到位", "登录游戏即可", "promotion", "promo", "campaign"])) {
    return { categoryId: "high_confidence_marketing", confidence: "high", reason: "metadata matches known marketing sender or promotion subject pattern" };
  }

  if (hasAny(domain, [
    "appwrite.io",
    "codeforces.com",
    "email.openai.com",
    "fwwb.org.cn",
    "github.com",
    "githubsupport.com",
    "gitkraken.com",
    "gitee.com",
    "lanqiao.cn",
    "mail.trae.ai",
    "openrouter.ai",
    "oschina.net",
    "qodo.ai",
    "system.trae.ai",
    "tab.digital",
    "team.mongodb.com",
    "edmsend.csdn.net",
    "hyperskill.org",
  ])
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
  ruleGroup: ClassificationGroup;
  ruleset?: ClassificationRulesetMetadata;
}): RulesetPatchDraft {
  const selectedRules = [
    ...input.candidates
      .filter((candidate) => input.selectedSenderDomains
        .some((selectedDomain) => includesIgnoreCase(candidate.domain, selectedDomain)))
      .map((candidate) => candidate.suggestedRule),
    ...input.selectedFromIncludes.map((fromNeedle) => buildSenderRule(fromNeedle, input.ruleGroup.id)),
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
    groupToEnsure: input.ruleGroup,
    candidateRuleCount: selectedRules.length,
    rulesToAdd,
    skippedDuplicateRules,
    ruleset: input.ruleset,
  };
}

function buildSenderRule(fromNeedle: string, groupId = "sender_governance"): ClassificationRule {
  return {
    id: `sender-from-${slugifyRuleId(fromNeedle)}`,
    groupId,
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

function scopedRuleIdSuffix(value: string): string {
  const slug = slugifyRuleId(value);
  const readableSlug = slug === "unknown" ? "folder" : slug;
  return `${readableSlug}-${stableHexHash(value)}`;
}

function stableHexHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function messageRefKey(ref: MessageRef): string {
  return `${ref.provider}\0${ref.accountAlias}\0${ref.folder}\0${ref.uid}\0${ref.uidValidity ?? ""}`;
}

function summarizeMessageRefs(refs: MessageRef[]): MessageRefAuditSummary {
  const keys = refs.map(messageRefKey);
  const grouped = groupMessageRefsByFolder(refs);
  return {
    count: refs.length,
    digest: digestValues(keys),
    duplicateCount: refs.length - new Set(keys).size,
    folders: [...grouped.entries()].map(([folder, folderRefs]) => {
      const numericUids = folderRefs
        .map((ref) => Number(ref.uid))
        .filter((uid) => Number.isSafeInteger(uid));
      const uidValidityValues = [...new Set(folderRefs.map((ref) => ref.uidValidity).filter((value): value is string => value !== undefined))];
      return {
        folder,
        count: folderRefs.length,
        ...(uidValidityValues.length === 1 ? { uidValidity: uidValidityValues[0] } : {}),
        firstUid: folderRefs[0]?.uid,
        lastUid: folderRefs[folderRefs.length - 1]?.uid,
        ...(numericUids.length > 0 ? { minUid: String(Math.min(...numericUids)), maxUid: String(Math.max(...numericUids)) } : {}),
        digest: digestValues(folderRefs.map(messageRefKey)),
      };
    }),
  };
}

function digestValues(values: string[]): string {
  return createHash("sha256").update(values.join("\n")).digest("hex").slice(0, 16);
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
    if (!result || result.moved < 0 || result.moved > folderRefs.length) {
      throw new Error(`QQ IMAP batch move returned invalid count for ${sourceFolder}: expected 0..${folderRefs.length}, got ${result?.moved ?? 0}`);
    }
    const reconciliation = await waitForFreshReconciliation({
      provider,
      sourceFolder,
      targetFolder,
      sourceBefore: sourceBefore.exists,
      targetBefore: targetBefore.exists,
      expectedSourceDelta: result.movedCountStatus === "unknown" ? undefined : -result.moved,
      expectedTargetDelta: result.movedCountStatus === "unknown" ? undefined : result.moved,
      maxTargetDelta: folderRefs.length,
    });
    reconciliations.push(reconciliation);
    moved += result.movedCountStatus === "unknown" ? reconciliation.targetDelta : result.moved;
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
  expectedSourceDelta?: number;
  expectedTargetDelta?: number;
  maxTargetDelta: number;
}): Promise<MoveMessagesReconciliation> {
  let latest: MoveMessagesReconciliation | undefined;
  for (let attempt = 0; attempt < MOVE_RECONCILE_ATTEMPTS; attempt += 1) {
    const sourceAfter = await input.provider.getMailboxSummary(input.sourceFolder);
    const targetAfter = await input.provider.getMailboxSummary(input.targetFolder);
    const targetDelta = targetAfter.exists - input.targetBefore;
    const sourceDelta = sourceAfter.exists - input.sourceBefore;
    const providerMoveCountKnown = input.expectedTargetDelta !== undefined;
    const targetDeltaReconciled = providerMoveCountKnown
      ? targetDelta === input.expectedTargetDelta
      : targetDelta >= 0 && targetDelta <= input.maxTargetDelta;
    const sourceDeltaReliable = providerMoveCountKnown
      ? sourceDelta === input.expectedSourceDelta
      : sourceDelta === -targetDelta;
    latest = {
      sourceFolder: input.sourceFolder,
      targetFolder: input.targetFolder,
      sourceBefore: input.sourceBefore,
      sourceAfter: sourceAfter.exists,
      sourceDelta,
      targetBefore: input.targetBefore,
      targetAfter: targetAfter.exists,
      targetDelta,
      expectedSourceDelta: input.expectedSourceDelta,
      expectedTargetDelta: input.expectedTargetDelta,
      targetDeltaReconciled,
      sourceDeltaReliable,
      sourceDeltaStatus: sourceDeltaReliable
        ? "matched"
        : "concurrent_or_external_change",
      reconciliationStatus: providerMoveCountKnown
        ? classifyMoveReconciliationStatus(targetDeltaReconciled, sourceDeltaReliable)
        : classifyUnknownMoveReconciliationStatus(targetDeltaReconciled),
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
  return reconciliation.targetDeltaReconciled;
}

function classifyMoveReconciliationStatus(
  targetDeltaReconciled: boolean,
  sourceDeltaReliable: boolean,
): MoveMessagesReconciliation["reconciliationStatus"] {
  if (!targetDeltaReconciled) {
    return "target_unreconciled";
  }
  return sourceDeltaReliable ? "matched" : "target_reconciled_source_unreliable";
}

function classifyUnknownMoveReconciliationStatus(
  targetDeltaReconciled: boolean,
): MoveMessagesReconciliation["reconciliationStatus"] {
  return targetDeltaReconciled ? "provider_result_unreliable" : "target_unreconciled";
}

function summarizeMoveReconciliationStatus(
  reconciliations: MoveMessagesReconciliation[] | undefined,
): ExecuteCleanupResult["reconciliationStatus"] {
  if (!reconciliations) {
    return "unavailable";
  }
  if (reconciliations.some((reconciliation) => reconciliation.reconciliationStatus === "target_unreconciled")) {
    return "target_unreconciled";
  }
  if (
    reconciliations.some(
      (reconciliation) => reconciliation.reconciliationStatus === "target_reconciled_source_unreliable",
    )
  ) {
    return "target_reconciled_source_unreliable";
  }
  if (
    reconciliations.some(
      (reconciliation) => reconciliation.reconciliationStatus === "provider_result_unreliable",
    )
  ) {
    return "provider_result_unreliable";
  }
  return "matched";
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

function normalizeSearchMessagesInput(input: SearchMessagesInput): SearchMessagesInput & { parsedQuery?: ParsedSearchQuery } {
  if (!input.query) return input;
  const parsedQuery = parseSearchQuery(input.query);
  const parsedFilters = parsedQuery.filters;
  return {
    ...input,
    folder: input.folder,
    query: parsedQuery.remainder || undefined,
    fromIncludes: input.fromIncludes ?? parsedFilters.fromIncludes,
    fromDomainIncludes: input.fromDomainIncludes ?? parsedFilters.fromDomainIncludes,
    subjectIncludes: input.subjectIncludes ?? parsedFilters.subjectIncludes,
    snippetIncludes: input.snippetIncludes ?? parsedFilters.snippetIncludes,
    hasFlag: input.hasFlag ?? parsedFilters.hasFlag,
    dateAfter: input.dateAfter ?? parsedFilters.dateAfter,
    dateBefore: input.dateBefore ?? parsedFilters.dateBefore,
    parsedQuery,
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
