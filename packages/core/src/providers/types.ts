import type { MessageRef } from "../operation-plan.js";

export interface MailboxInfo {
  path: string;
  delimiter?: string;
  flags?: string[];
}

export interface ScanMailboxMetadataInput {
  folder: string;
  limit: number;
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
}
