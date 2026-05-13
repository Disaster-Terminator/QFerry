import { describe, expect, it } from "vitest";

import { parseClassificationRuleset } from "../src/ruleset.js";
import { formatRulesetPatchChangelog, renderRulesetPatchDraft } from "../src/ruleset-patch.js";

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
});
