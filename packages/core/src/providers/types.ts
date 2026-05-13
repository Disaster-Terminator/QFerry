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
  maxRecommendedScanLimit: number;
}

export interface ScanMailboxMetadataInput {
  folder: string;
  limit: number;
  order?: "newest" | "oldest";
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
  fetchMessage(ref: MessageRef): Promise<MessageDetail>;
  getCapabilitySnapshot?(): Promise<ProviderCapabilitySnapshot>;
  getMailboxSummary?(folder: string): Promise<MailboxSummary>;
}
