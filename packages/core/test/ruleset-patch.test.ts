import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseClassificationRuleset } from "../src/ruleset.js";
import {
  applyRulesetPatchDraft,
  formatRulesetPatchChangelog,
  renderRulesetPatchDraft,
} from "../src/ruleset-patch.js";

describe("ruleset patch rendering", () => {
  it("renders a selected sender governance patch as a complete ruleset draft", () => {
    const patch = {
      groupToEnsure: { id: "sender_governance", label: "Sender governance" } as const,
      candidateRuleCount: 1,
      rulesToAdd: [
        {
          id: "sender-domain-example-com",
          groupId: "sender_governance",
          match: { fromDomainIncludes: "example.com" },
        },
      ],
      skippedDuplicateRules: [],
    };

    const draft = renderRulesetPatchDraft(patch);

    expect(draft).toMatchObject({
      version: "sender-governance-draft",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Needs review" },
        { id: "sender_governance", label: "Sender governance" },
      ],
      rules: [
        {
          id: "sender-domain-example-com",
          groupId: "sender_governance",
          match: { fromDomainIncludes: "example.com" },
        },
      ],
    });
    expect(() => parseClassificationRuleset(draft, "draft")).not.toThrow();
  });

  it("appends rules without duplicating an existing sender governance group", () => {
    const existing = parseClassificationRuleset({
      version: "existing",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Needs review" },
        { id: "sender_governance", label: "Sender governance" },
      ],
      rules: [{ id: "existing", groupId: "review", match: { subjectIncludes: "keep" } }],
    }, "memory");
    const patch = {
      groupToEnsure: { id: "sender_governance", label: "Sender governance" } as const,
      candidateRuleCount: 1,
      rulesToAdd: [
        { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
      ],
      skippedDuplicateRules: [],
      ruleset: existing.metadata,
    };

    const draft = renderRulesetPatchDraft(patch, existing);

    expect(draft.groups.filter((group) => group.id === "sender_governance")).toHaveLength(1);
    expect(draft.rules.map((rule) => rule.id)).toEqual(["existing", "sender-domain-example-com"]);
    expect(draft.version).toBe("existing");
    expect(() => parseClassificationRuleset(draft, "draft")).not.toThrow();
  });

  it("formats a human-readable changelog for added and skipped rules", () => {
    const changelog = formatRulesetPatchChangelog({
      groupToEnsure: { id: "sender_governance", label: "Sender governance" },
      candidateRuleCount: 2,
      rulesToAdd: [
        { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
      ],
      skippedDuplicateRules: [
        {
          ruleId: "existing-example-domain",
          reason: "match already covered by existing rule",
          match: { fromDomainIncludes: "example.com" },
        },
      ],
    });

    expect(changelog).toContain("rulesToAdd: 1");
    expect(changelog).toContain("+ rule sender-domain-example-com");
    expect(changelog).toContain("skipped existing-example-domain");
  });

  it("dry-runs and applies a ruleset patch to a local rules file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ruleset-apply-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Needs review" }],
      rules: [{ id: "keep", groupId: "review", match: { subjectIncludes: "keep" } }],
    }, null, 2)}\n`, "utf8");
    const patch = {
      groupToEnsure: { id: "sender_governance", label: "Sender governance" } as const,
      candidateRuleCount: 1,
      rulesToAdd: [
        { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
      ],
      skippedDuplicateRules: [],
    };

    const dryRun = await applyRulesetPatchDraft({ rulesFile, patch, apply: false });

    expect(dryRun).toMatchObject({
      applied: false,
      rulesFile,
      beforeRuleCount: 1,
      afterRuleCount: 2,
      addedRuleCount: 1,
      skippedDuplicateRuleCount: 0,
    });
    expect(dryRun.changelog).toContain("+ rule sender-domain-example-com");
    expect(JSON.parse(await readFile(rulesFile, "utf8")).rules).toHaveLength(1);

    const applied = await applyRulesetPatchDraft({ rulesFile, patch, apply: true });

    expect(applied.applied).toBe(true);
    expect(applied.renderedDraft.rules).toHaveLength(2);
    expect(JSON.parse(await readFile(rulesFile, "utf8")).rules).toHaveLength(2);
  });

  it("bootstraps a local rules file that has groups but no rules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ruleset-bootstrap-"));
    const rulesFile = join(dir, "qferry.rules.json");
    await writeFile(rulesFile, `${JSON.stringify({
      version: "empty-local",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Review" }],
      rules: [],
    }, null, 2)}\n`, "utf8");
    const patch = {
      groupToEnsure: { id: "sender_governance", label: "Sender governance" } as const,
      candidateRuleCount: 1,
      rulesToAdd: [
        { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
      ],
      skippedDuplicateRules: [],
    };

    const applied = await applyRulesetPatchDraft({ rulesFile, patch, apply: true });

    expect(applied).toMatchObject({
      applied: true,
      beforeRuleCount: 0,
      afterRuleCount: 1,
      addedRuleCount: 1,
    });
    expect(JSON.parse(await readFile(rulesFile, "utf8"))).toMatchObject({
      version: "empty-local",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "sender_governance", label: "Sender governance" },
      ],
      rules: [
        { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
      ],
    });
  });

  it("rejects applying a ruleset patch to a non-standard file name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ruleset-apply-"));
    const rulesFile = join(dir, "not-rules.txt");
    const original = `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Needs review" }],
      rules: [{ id: "keep", groupId: "review", match: { subjectIncludes: "keep" } }],
    }, null, 2)}\n`;
    await writeFile(rulesFile, original, "utf8");
    const patch = {
      groupToEnsure: { id: "sender_governance", label: "Sender governance" } as const,
      candidateRuleCount: 1,
      rulesToAdd: [
        { id: "sender-domain-example-com", groupId: "sender_governance", match: { fromDomainIncludes: "example.com" } },
      ],
      skippedDuplicateRules: [],
    };

    await expect(applyRulesetPatchDraft({ rulesFile, patch, apply: true }))
      .rejects.toThrow("qferry.rules.json");
    expect(await readFile(rulesFile, "utf8")).toBe(original);
  });
});
