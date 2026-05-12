import type { MailboxInfo, MailProvider, MessageDetail, MessageSummary, ScanMailboxMetadataInput } from "./types.js";
import type { MessageRef } from "../operation-plan.js";

interface FixtureMessage extends MessageDetail {}

export class FixtureMailProvider implements MailProvider {
  private constructor(
    private readonly mailboxes: MailboxInfo[],
    private readonly messages: FixtureMessage[],
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

  async listMailboxes(): Promise<MailboxInfo[]> {
    return this.mailboxes;
  }

  async scanMailboxMetadata(input: ScanMailboxMetadataInput): Promise<MessageSummary[]> {
    return this.messages
      .filter((message) => message.ref.folder === input.folder)
      .slice(0, Math.max(0, input.limit))
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
}
