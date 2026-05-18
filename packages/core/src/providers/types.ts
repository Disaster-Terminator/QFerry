import type { MessageRef } from "../operation-plan.js";

export interface MailboxInfo {
  path: string;
  delimiter?: string;
  flags?: string[];
}

export interface MailboxSummary {
  path: string;
  exists: number;
  uidValidity?: string;
}

export interface ProviderCapabilitySnapshot {
  provider: string;
  accountAlias: string;
  supportsListMailboxes: boolean;
  supportsMetadataScan: boolean;
  supportsFetchMessage: boolean;
  supportsMutation: boolean;
  mutationActions: string[];
  supportsCreateMailbox?: boolean;
  maxRecommendedScanLimit: number;
}

export interface ScanMailboxMetadataInput {
  folder: string;
  limit: number;
  order?: "newest" | "oldest";
  offset?: number;
}

export interface ScanMailboxMetadataWindowInput extends ScanMailboxMetadataInput {
  maxPages: number;
}

export interface MailboxWindowSnapshot {
  folder: string;
  exists: number;
  uidValidity?: string;
}

export interface ScanMailboxMetadataWindowResult {
  messages: MessageSummary[];
  pagesScanned: number;
  mailboxSnapshot?: MailboxWindowSnapshot;
}

export interface MessageSummary {
  ref: MessageRef;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  flags: string[];
}

export interface MessageDetail extends MessageSummary {
  bodyText: string;
}

export interface MailProvider {
  listMailboxes(): Promise<MailboxInfo[]>;
  scanMailboxMetadata(input: ScanMailboxMetadataInput): Promise<MessageSummary[]>;
  scanMailboxMetadataWindow?(input: ScanMailboxMetadataWindowInput): Promise<ScanMailboxMetadataWindowResult>;
  fetchMessage(ref: MessageRef): Promise<MessageDetail>;
  getCapabilitySnapshot?(): Promise<ProviderCapabilitySnapshot>;
  getMailboxSummary?(folder: string): Promise<MailboxSummary>;
  moveMessages?(refs: MessageRef[], targetFolder: string): Promise<MoveMessagesResult>;
  createMailbox?(folder: string): Promise<{ path: string; created: boolean }>;
}

export interface MoveMessagesReconciliation {
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
}

export interface MoveMessagesResult {
  moved: number;
  movedCountStatus?: "exact" | "unknown";
  reconciliations?: MoveMessagesReconciliation[];
}
