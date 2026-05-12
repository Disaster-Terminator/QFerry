import { ImapFlow } from "imapflow";
import type { MessageRef } from "../operation-plan.js";
import type {
  MailboxInfo,
  MailProvider,
  MessageDetail,
  MessageSummary,
  ProviderCapabilitySnapshot,
  ScanMailboxMetadataInput,
} from "./types.js";

interface QqReadOnlyClient {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(): Promise<Array<{ path: string; delimiter?: string; flags?: Set<string> }>>;
  mailboxOpen(path: string, options?: { readOnly?: boolean }): Promise<{ exists: number; uidValidity?: bigint | number | string }>;
  fetch(range: string, query: Record<string, unknown>, options?: Record<string, unknown>): AsyncIterable<{
    uid: number;
    flags?: Set<string>;
    size?: number;
    internalDate?: Date | string;
    envelope?: {
      from?: Array<{ name?: string; address?: string }>;
      subject?: string;
      date?: Date;
    };
  }>;
}

export interface QqReadOnlyProviderInput {
  accountAlias: string;
  auth: {
    user: string;
    pass: string;
  };
  host?: string;
  port?: number;
  maxRecommendedScanLimit?: number;
  clientFactory?: () => QqReadOnlyClient;
}

export class QqReadOnlyProvider implements MailProvider {
  private readonly maxRecommendedScanLimit: number;

  constructor(private readonly input: QqReadOnlyProviderInput) {
    this.maxRecommendedScanLimit = Math.min(Math.max(input.maxRecommendedScanLimit ?? 10, 1), 10);
  }

  async getCapabilitySnapshot(): Promise<ProviderCapabilitySnapshot> {
    return {
      provider: "qqmail",
      accountAlias: this.input.accountAlias,
      supportsListMailboxes: true,
      supportsMetadataScan: true,
      supportsFetchMessage: true,
      supportsMutation: false,
      mutationActions: [],
      maxRecommendedScanLimit: this.maxRecommendedScanLimit,
    };
  }

  async listMailboxes(): Promise<MailboxInfo[]> {
    return this.withClient(async (client) => {
      const mailboxes = await client.list();
      return mailboxes.map((mailbox) => ({
        path: mailbox.path,
        delimiter: mailbox.delimiter,
        flags: mailbox.flags ? [...mailbox.flags] : [],
      }));
    });
  }

  async scanMailboxMetadata(input: ScanMailboxMetadataInput): Promise<MessageSummary[]> {
    const limit = Math.min(Math.max(input.limit, 0), this.maxRecommendedScanLimit);
    if (limit === 0) return [];

    return this.withClient(async (client) => {
      const mailbox = await client.mailboxOpen(input.folder, { readOnly: true });
      const end = Math.max(mailbox.exists, 1);
      const start = Math.max(end - limit + 1, 1);
      const messages: MessageSummary[] = [];

      for await (const message of client.fetch(
        `${start}:${end}`,
        { envelope: true, flags: true, internalDate: true, size: true, uid: true },
        { uid: false },
      )) {
        messages.push(toMessageSummary({
          accountAlias: this.input.accountAlias,
          folder: input.folder,
          uidValidity: mailbox.uidValidity,
          message,
        }));
      }

      return messages;
    });
  }

  async fetchMessage(ref: MessageRef): Promise<MessageDetail> {
    if (ref.provider !== "qqmail") {
      throw new Error(`QQ provider cannot fetch ${ref.provider} message refs`);
    }
    const messages = await this.scanMailboxMetadata({ folder: ref.folder, limit: this.maxRecommendedScanLimit });
    const found = messages.find((message) => message.ref.uid === ref.uid);
    if (!found) {
      throw new Error(`QQ message not found in bounded read-only scan: ${ref.folder}/${ref.uid}`);
    }
    return { ...found, bodyText: "" };
  }

  private createClient(): QqReadOnlyClient {
    if (this.input.clientFactory) {
      return this.input.clientFactory();
    }

    return new ImapFlow({
      host: this.input.host ?? "imap.qq.com",
      port: this.input.port ?? 993,
      secure: true,
      logger: false,
      auth: this.input.auth,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 20_000,
    }) as unknown as QqReadOnlyClient;
  }

  private async withClient<T>(fn: (client: QqReadOnlyClient) => Promise<T>): Promise<T> {
    const client = this.createClient();
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}

function toMessageSummary(input: {
  accountAlias: string;
  folder: string;
  uidValidity?: bigint | number | string;
  message: {
    uid: number;
    flags?: Set<string>;
    size?: number;
    internalDate?: Date | string;
    envelope?: {
      from?: Array<{ name?: string; address?: string }>;
      subject?: string;
      date?: Date;
    };
  };
}): MessageSummary {
  const date = input.message.envelope?.date ?? input.message.internalDate ?? new Date(0);
  return {
    ref: {
      provider: "qqmail",
      accountAlias: input.accountAlias,
      folder: input.folder,
      uid: String(input.message.uid),
      uidValidity: input.uidValidity === undefined ? undefined : String(input.uidValidity),
    },
    from: formatAddress(input.message.envelope?.from?.[0]),
    subject: input.message.envelope?.subject ?? "",
    date: date instanceof Date ? date.toISOString() : new Date(date).toISOString(),
    snippet: input.message.size === undefined ? "" : `size=${input.message.size}`,
    flags: input.message.flags ? [...input.message.flags] : [],
  };
}

function formatAddress(address?: { name?: string; address?: string }): string {
  if (!address) return "";
  if (address.name && address.address) return `${address.name} <${address.address}>`;
  return address.address ?? address.name ?? "";
}
