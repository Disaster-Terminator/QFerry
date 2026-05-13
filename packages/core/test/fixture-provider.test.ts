import { describe, expect, it } from "vitest";

import { FixtureMailProvider } from "../src/providers/fixture-provider.js";

describe("FixtureMailProvider", () => {
  it("lists fixture mailboxes", async () => {
    const provider = FixtureMailProvider.demo();

    const mailboxes = await provider.listMailboxes();

    expect(mailboxes.map((mailbox) => mailbox.path)).toEqual(["INBOX", "Archive"]);
  });

  it("summarizes fixture mailbox counts", async () => {
    const provider = FixtureMailProvider.demo();

    await expect(provider.getMailboxSummary("INBOX")).resolves.toEqual({
      path: "INBOX",
      exists: 2,
    });
  });

  it("scans mailbox metadata without exposing message body", async () => {
    const provider = FixtureMailProvider.demo();

    const messages = await provider.scanMailboxMetadata({ folder: "INBOX", limit: 5 });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      ref: { provider: "fixture", folder: "INBOX", uid: "1" },
      subject: "Security alert",
    });
    expect(JSON.stringify(messages)).not.toContain("full body");
  });

  it("enforces scan limits", async () => {
    const provider = FixtureMailProvider.demo();

    const messages = await provider.scanMailboxMetadata({ folder: "INBOX", limit: 1 });

    expect(messages).toHaveLength(1);
    expect(messages[0].ref.uid).toBe("1");
  });

  it("fetches full message content only by explicit message ref", async () => {
    const provider = FixtureMailProvider.demo();
    const [summary] = await provider.scanMailboxMetadata({ folder: "INBOX", limit: 1 });

    const detail = await provider.fetchMessage(summary.ref);

    expect(detail.bodyText).toContain("fixture full body");
    expect(detail.ref).toEqual(summary.ref);
  });
});
