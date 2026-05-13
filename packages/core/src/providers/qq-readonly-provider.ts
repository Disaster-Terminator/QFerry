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

export interface QqReadOnlyClient {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(): Promise<Array<{ path: string; delimiter?: string; flags?: Set<string> }>>;
  mailboxOpen(path: string, options?: { readOnly?: boolean }): Promise<{ exists: number; uidValidity?: bigint | number | string; readOnly?: boolean }>;
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
  messageMove?(range: string | number[], destination: string, options?: { uid?: boolean }): Promise<{ uidMap?: Map<number, number> } | false>;
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
  connectionCooldownMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clientFactory?: () => QqReadOnlyClient;
}

export class QqProviderError extends Error {
  readonly provider = "qqmail";
  readonly operation: string;
  readonly stage: "connect" | "command";
  readonly originalMessage: string;
  readonly originalName?: string;
  readonly originalCode?: string;

  constructor(input: {
    operation: string;
    stage: "connect" | "command";
    cause: unknown;
  }) {
    const details = describeCause(input.cause);
    super(`QQ IMAP ${input.operation} failed during ${input.stage}: ${details.message}`);
    this.name = "QqProviderError";
    this.operation = input.operation;
    this.stage = input.stage;
    this.originalMessage = details.message;
    this.originalName = details.name;
    this.originalCode = details.code;
  }
}

export class QqReadOnlyProvider implements MailProvider {
  private readonly maxRecommendedScanLimit: number;
  private readonly connectionCooldownMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private operationQueue: Promise<void> = Promise.resolve();
  private hasConnected = false;

  constructor(private readonly input: QqReadOnlyProviderInput) {
    this.maxRecommendedScanLimit = Math.min(Math.max(input.maxRecommendedScanLimit ?? 10, 1), 10);
    this.connectionCooldownMs = Math.max(input.connectionCooldownMs ?? 750, 0);
    this.sleep = input.sleep ?? defaultSleep;
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
    return this.withClient("list_mailboxes", async (client) => {
      const mailboxes = await client.list();
      return mailboxes.map((mailbox) => ({
        path: mailbox.path,
        delimiter: mailbox.delimiter,
        flags: mailbox.flags ? [...mailbox.flags] : [],
      }));
    });
  }

  async getMailboxSummary(folder: string) {
    return this.withClient("get_mailbox_summary", async (client) => {
      const mailbox = await client.mailboxOpen(folder, { readOnly: true });
      return {
        path: folder,
        exists: mailbox.exists,
        uidValidity: mailbox.uidValidity === undefined ? undefined : String(mailbox.uidValidity),
      };
    });
  }

  async scanMailboxMetadata(input: ScanMailboxMetadataInput): Promise<MessageSummary[]> {
    const limit = Math.min(Math.max(input.limit, 0), this.maxRecommendedScanLimit);
    if (limit === 0) return [];

    return this.withClient("scan_mailbox_metadata", async (client) => {
      const mailbox = await client.mailboxOpen(input.folder, { readOnly: true });
      const newest = input.order !== "oldest";
      const end = newest ? Math.max(mailbox.exists, 1) : Math.min(limit, Math.max(mailbox.exists, 1));
      const start = newest ? Math.max(end - limit + 1, 1) : 1;
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

  protected createClient(): QqReadOnlyClient {
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

  protected async withClient<T>(operation: string, fn: (client: QqReadOnlyClient) => Promise<T>): Promise<T> {
    return this.enqueueOperation(() => this.withConnectedClient(operation, fn));
  }

  private async enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release: () => void = () => undefined;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async withConnectedClient<T>(operation: string, fn: (client: QqReadOnlyClient) => Promise<T>): Promise<T> {
    const client = this.createClient();
    try {
      if (this.hasConnected && this.connectionCooldownMs > 0) {
        await this.sleep(this.connectionCooldownMs);
      }
      await client.connect();
      this.hasConnected = true;
    } catch (error) {
      throw new QqProviderError({ operation, stage: "connect", cause: error });
    }
    try {
      return await fn(client);
    } catch (error) {
      throw new QqProviderError({ operation, stage: "command", cause: error });
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeCause(cause: unknown): { message: string; name?: string; code?: string } {
  if (cause instanceof Error) {
    const withCode = cause as Error & { code?: unknown };
    return {
      message: cause.message || cause.name,
      name: cause.name,
      code: typeof withCode.code === "string" ? withCode.code : undefined,
    };
  }
  return { message: String(cause) };
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
