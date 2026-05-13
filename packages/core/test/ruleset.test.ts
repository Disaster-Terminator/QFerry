import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { loadClassificationRuleset, parseClassificationRuleset } from "../src/ruleset.js";

describe("classification ruleset", () => {
  it("parses ruleset metadata, groups, and classification rules", () => {
    const ruleset = parseClassificationRuleset({
      version: "2026-05-12",
      defaultGroupId: "review",
      groups: [
        { id: "archive", label: "Archive later" },
        { id: "review", label: "Needs review" },
      ],
      rules: [
        {
          id: "newsletter",
          groupId: "archive",
          match: { fromIncludes: "newsletter@", fromDomainIncludes: "example.com" },
          priority: {
            bucketId: "bulk",
            reason: "Configured newsletter sender rule",
            confidence: "medium",
            weight: 40,
            nextAction: "Archive after review",
          },
        },
      ],
    }, "memory");

    expect(ruleset.metadata).toEqual({
      source: "memory",
      version: "2026-05-12",
      defaultGroupId: "review",
      groupCount: 2,
      ruleCount: 1,
    });
    expect(ruleset.rules[0]?.groupId).toBe("archive");
    expect(ruleset.rules[0]?.match).toMatchObject({ fromDomainIncludes: "example.com" });
    expect(ruleset.rules[0]?.priority).toEqual({
      bucketId: "bulk",
      reason: "Configured newsletter sender rule",
      confidence: "medium",
      weight: 40,
      nextAction: "Archive after review",
    });
  });

  it("loads a ruleset from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ruleset-"));
    const path = join(dir, "qferry.rules.json");
    await writeFile(path, JSON.stringify({
      version: "disk-v1",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Review" }],
      rules: [{ id: "security", groupId: "review", match: { subjectIncludes: "security" } }],
    }), "utf8");

    const ruleset = await loadClassificationRuleset(path);

    expect(ruleset.metadata).toMatchObject({
      source: path,
      version: "disk-v1",
      ruleCount: 1,
    });
  });

  it("rejects rulesets without rules", () => {
    expect(() => parseClassificationRuleset({
      version: "empty",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Review" }],
      rules: [],
    }, "memory")).toThrow("at least one rule");
  });
});
