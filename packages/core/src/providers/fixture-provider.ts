import type {
  MailboxInfo,
  MailProvider,
  MessageDetail,
  MessageSummary,
  ProviderCapabilitySnapshot,
  ScanMailboxMetadataInput,
} from "./types.js";
import type { MessageRef } from "../operation-plan.js";

interface FixtureMessage extends MessageDetail {}

export class FixtureMailProvider implements MailProvider {
  private constructor(
    private readonly mailboxes: MailboxInfo[],
    private readonly messages: FixtureMessage[],
    private readonly mutable = false,
  ) {}

  static demo(): FixtureMailProvider {
    return new FixtureMailProvider(
      [
        { path: "INBOX", delimiter: "/", flags: [] },
        { path: "Archive", delimiter: "/", flags: [] },
      ],
      [
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "1" },
          from: "security@example.com",
          subject: "Security alert",
          date: "2026-05-12T00:00:00.000Z",
          snippet: "A security notification that should be reviewed.",
          flags: [],
          bodyText: "fixture full body for security alert",
        },
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "INBOX", uid: "2" },
          from: "newsletter@example.com",
          subject: "Weekly digest",
          date: "2026-05-11T00:00:00.000Z",
          snippet: "A low priority newsletter.",
          flags: ["\\Seen"],
          bodyText: "fixture full body for weekly digest",
        },
        {
          ref: { provider: "fixture", accountAlias: "demo", folder: "Archive", uid: "3" },
          from: "billing@example.com",
          subject: "Receipt",
          date: "2026-05-10T00:00:00.000Z",
          snippet: "A receipt already archived.",
          flags: ["\\Seen"],
          bodyText: "fixture full body for receipt",
        },
      ],
    );
  }

  static mutableDemo(): FixtureMailProvider {
    const provider = FixtureMailProvider.demo();
    return new FixtureMailProvider(provider.mailboxes, provider.messages, true);
  }

  async listMailboxes(): Promise<MailboxInfo[]> {
    return this.mailboxes;
  }

  async getCapabilitySnapshot(): Promise<ProviderCapabilitySnapshot> {
    return {
      provider: "fixture",
      accountAlias: "demo",
      supportsListMailboxes: true,
      supportsMetadataScan: true,
      supportsFetchMessage: true,
      supportsMutation: this.mutable,
      mutationActions: this.mutable ? ["move"] : [],
      maxRecommendedScanLimit: 10,
    };
  }

  async getMailboxSummary(folder: string) {
    return {
      path: folder,
      exists: this.messages.filter((message) => message.ref.folder === folder).length,
    };
  }

  async scanMailboxMetadata(input: ScanMailboxMetadataInput): Promise<MessageSummary[]> {
    const messages = this.messages
      .filter((message) => message.ref.folder === input.folder);
    const ordered = input.order === "oldest" ? [...messages].reverse() : messages;
    return ordered
      .slice(Math.max(0, input.offset ?? 0), Math.max(0, input.offset ?? 0) + Math.max(0, input.limit))
      .map(({ bodyText: _bodyText, ...summary }) => summary);
  }

  async fetchMessage(ref: MessageRef): Promise<MessageDetail> {
    const message = this.messages.find((candidate) =>
      candidate.ref.provider === ref.provider &&
      candidate.ref.accountAlias === ref.accountAlias &&
      candidate.ref.folder === ref.folder &&
      candidate.ref.uid === ref.uid
    );

    if (!message) {
      throw new Error(`Fixture message not found: ${ref.folder}/${ref.uid}`);
    }

    return message;
  }

  async moveMessages(refs: MessageRef[], targetFolder: string): Promise<{ moved: number }> {
    if (!this.mutable) {
      throw new Error("Fixture provider mutation is disabled");
    }
    if (!this.mailboxes.some((mailbox) => mailbox.path === targetFolder)) {
      this.mailboxes.push({ path: targetFolder, delimiter: "/", flags: [] });
    }
    const refKeys = new Set(refs.map((ref) => `${ref.provider}:${ref.accountAlias}:${ref.folder}:${ref.uid}`));
    let moved = 0;
    for (const message of this.messages) {
      const key = `${message.ref.provider}:${message.ref.accountAlias}:${message.ref.folder}:${message.ref.uid}`;
      if (refKeys.has(key)) {
        message.ref = { ...message.ref, folder: targetFolder };
        moved += 1;
      }
    }
    return { moved };
  }
}
