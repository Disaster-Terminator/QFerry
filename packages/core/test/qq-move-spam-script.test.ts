import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));

describe("QQ move spam e2e script rules", () => {
  it("includes conservative real-mailbox ad rules without requiring live mailbox execution", async () => {
    const scriptPath = resolve(testDir, "../../../scripts/run-qferry-plugin-qq-move-spam-e2e.mjs");
    const module = await import(pathToFileURL(scriptPath).href);

    expect(module.spamRules()).toEqual(expect.arrayContaining([
      { id: "ad-tag-subject", groupId: "ads_or_spam", match: { subjectIncludes: "(AD)" } },
      { id: "wargaming-promo-from", groupId: "ads_or_spam", match: { fromIncludes: "@prm.wargaming.net" } },
      { id: "epic-games-store-from", groupId: "ads_or_spam", match: { fromIncludes: "store@mail.epicgames.com" } },
      { id: "sony-crm-promo-from", groupId: "ads_or_spam", match: { fromIncludes: "sony_crm@postermaster.sony.com.cn" } },
    ]));
  });

  it("redacts sampled real messages while keeping auditable fingerprints", async () => {
    const scriptPath = resolve(testDir, "../../../scripts/run-qferry-plugin-qq-move-spam-e2e.mjs");
    const module = await import(pathToFileURL(scriptPath).href);

    expect(module.summarizeSampledMessages([
      {
        ref: { uid: "123" },
        from: "Example Sender <sender@example.com>",
        subject: "private subject line",
        date: "2026-05-13T00:00:00.000Z",
        flags: ["\\Seen"],
      },
    ])).toEqual([
      {
        uid: "123",
        fromDomain: "example.com",
        subjectHash: "9534393accbb",
        subjectLength: 20,
        date: "2026-05-13T00:00:00.000Z",
        flags: ["\\Seen"],
      },
    ]);
  });
});
