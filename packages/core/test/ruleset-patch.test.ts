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

  it("replaces existing rules in place before appending new rules", () => {
    const existing = parseClassificationRuleset({
      version: "existing",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Needs review" },
        { id: "account_security", label: "Account security" },
        { id: "ai_dev_tools", label: "AI dev tools" },
      ],
      rules: [
        { id: "sender-domain-tm-openai-com", groupId: "account_security", match: { fromDomainIncludes: "tm.openai.com" } },
        { id: "keep", groupId: "review", match: { subjectIncludes: "keep" } },
      ],
    }, "memory");
    const patch = {
      groupToEnsure: { id: "ai_dev_tools", label: "AI dev tools" } as const,
      candidateRuleCount: 2,
      rulesToReplace: [
        {
          id: "sender-domain-tm-openai-com",
          groupId: "account_security",
          match: { fromDomainIncludes: "tm.openai.com", subjectIncludes: "verification" },
        },
      ],
      rulesToAdd: [
        {
          id: "sender-domain-tm-openai-com-task-update",
          groupId: "ai_dev_tools",
          match: { fromDomainIncludes: "tm.openai.com", subjectIncludes: "[Task Update]" },
        },
      ],
      skippedDuplicateRules: [],
      ruleset: existing.metadata,
    };

    const draft = renderRulesetPatchDraft(patch, existing);

    expect(draft.rules.map(({ priority, ...rule }) => rule)).toEqual([
      {
        id: "sender-domain-tm-openai-com",
        groupId: "account_security",
        match: { fromDomainIncludes: "tm.openai.com", subjectIncludes: "verification" },
      },
      { id: "keep", groupId: "review", match: { subjectIncludes: "keep" } },
      {
        id: "sender-domain-tm-openai-com-task-update",
        groupId: "ai_dev_tools",
        match: { fromDomainIncludes: "tm.openai.com", subjectIncludes: "[Task Update]" },
      },
    ]);
    expect(() => parseClassificationRuleset(draft, "draft")).not.toThrow();
  });

  it("formats a human-readable changelog for added and skipped rules", () => {
    const changelog = formatRulesetPatchChangelog({
      groupToEnsure: { id: "sender_governance", label: "Sender governance" },
      candidateRuleCount: 2,
      rulesToReplace: [
        { id: "replace-me", groupId: "sender_governance", match: { fromDomainIncludes: "old.example.com" } },
      ],
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
    expect(changelog).toContain("rulesToReplace: 1");
    expect(changelog).toContain("~ rule replace-me");
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
    expect(dryRun.renderedDraft).toBeUndefined();
    const dryRunWithDraft = await applyRulesetPatchDraft({
      rulesFile,
      patch,
      apply: false,
      includeRenderedDraft: true,
    });
    expect(dryRunWithDraft.renderedDraft?.rules).toHaveLength(2);
    expect(JSON.parse(await readFile(rulesFile, "utf8")).rules).toHaveLength(1);

    const applied = await applyRulesetPatchDraft({ rulesFile, patch, apply: true });

    expect(applied.applied).toBe(true);
    expect(applied.renderedDraft).toBeUndefined();
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

  it("rejects missing replacement rule ids without writing the rules file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ruleset-replace-missing-"));
    const rulesFile = join(dir, "qferry.rules.json");
    const original = `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Review" }],
      rules: [{ id: "keep", groupId: "review", match: { subjectIncludes: "keep" } }],
    }, null, 2)}\n`;
    await writeFile(rulesFile, original, "utf8");
    const patch = {
      groupToEnsure: { id: "review", label: "Review" } as const,
      candidateRuleCount: 1,
      rulesToReplace: [
        { id: "missing-rule", groupId: "review", match: { subjectIncludes: "missing" } },
      ],
      rulesToAdd: [],
      skippedDuplicateRules: [],
    };

    await expect(applyRulesetPatchDraft({ rulesFile, patch, apply: true }))
      .rejects.toThrow("replacement target not found");
    expect(await readFile(rulesFile, "utf8")).toBe(original);
  });

  it("rejects rule ids that are both replaced and added without writing the rules file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ruleset-replace-overlap-"));
    const rulesFile = join(dir, "qferry.rules.json");
    const original = `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Review" }],
      rules: [{ id: "overlap", groupId: "review", match: { subjectIncludes: "old" } }],
    }, null, 2)}\n`;
    await writeFile(rulesFile, original, "utf8");
    const patch = {
      groupToEnsure: { id: "review", label: "Review" } as const,
      candidateRuleCount: 2,
      rulesToReplace: [
        { id: "overlap", groupId: "review", match: { subjectIncludes: "new" } },
      ],
      rulesToAdd: [
        { id: "overlap", groupId: "review", match: { subjectIncludes: "also-new" } },
      ],
      skippedDuplicateRules: [],
    };

    await expect(applyRulesetPatchDraft({ rulesFile, patch, apply: true }))
      .rejects.toThrow("cannot both replace and add rule id");
    expect(await readFile(rulesFile, "utf8")).toBe(original);
  });

  it("rejects replacement rules that reference undeclared groups without writing the rules file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-ruleset-replace-unknown-group-"));
    const rulesFile = join(dir, "qferry.rules.json");
    const original = `${JSON.stringify({
      version: "existing",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Review" }],
      rules: [{ id: "move-me", groupId: "review", match: { subjectIncludes: "old" } }],
    }, null, 2)}\n`;
    await writeFile(rulesFile, original, "utf8");
    const patch = {
      groupToEnsure: { id: "review", label: "Review" } as const,
      candidateRuleCount: 1,
      rulesToReplace: [
        { id: "move-me", groupId: "missing_group", match: { subjectIncludes: "new" } },
      ],
      rulesToAdd: [],
      skippedDuplicateRules: [],
    };

    await expect(applyRulesetPatchDraft({ rulesFile, patch, apply: true }))
      .rejects.toThrow("unknown groupId");
    expect(await readFile(rulesFile, "utf8")).toBe(original);
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
