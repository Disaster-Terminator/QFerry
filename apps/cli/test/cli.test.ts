import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCli } from "../src/cli.js";

async function invoke(args: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    cwd: options.cwd,
    env: { QFERRY_PROVIDER: "fixture", ...options.env },
    stdout: (chunk) => stdout.push(chunk),
    stderr: (chunk) => stderr.push(chunk),
  });
  return {
    code,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    json: stdout.length ? JSON.parse(stdout.join("")) : undefined,
  };
}

describe("qferry cli", () => {
  const originalTraceRoot = process.env.QFERRY_CLI_TRACE_ROOT;

  afterEach(() => {
    if (originalTraceRoot === undefined) {
      delete process.env.QFERRY_CLI_TRACE_ROOT;
    } else {
      process.env.QFERRY_CLI_TRACE_ROOT = originalTraceRoot;
    }
  });

  it("prints fixture status as JSON", async () => {
    const result = await invoke(["status"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      ok: true,
      command: "status",
      result: {
        status: {
          provider: "fixture",
          accountAlias: "demo",
        },
      },
    });
  });

  it("accepts pnpm-style argument separator before the command", async () => {
    const result = await invoke(["--", "status"]);

    expect(result.code).toBe(0);
    expect(result.json.command).toBe("status");
    expect(result.json.result.status.provider).toBe("fixture");
  });

  it("runs high-yield governance and writes trace artifacts", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-cli-trace-"));
    const result = await invoke([
      "high-yield",
      "--run-id",
      "cli-high-yield-test",
      "--folder",
      "INBOX",
      "--page-size",
      "50",
      "--max-pages",
      "1",
      "--min-message-count",
      "3",
      "--group-id",
      "bulk_platform",
      "--group-label",
      "Bulk platform",
      "--target-folder",
      "Bulk platform",
    ], { env: { QFERRY_CLI_TRACE_ROOT: traceRoot } });

    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({
      ok: true,
      command: "high-yield",
      runId: "cli-high-yield-test",
      audit: {
        runId: "cli-high-yield-test",
      },
      result: {
        planner: {
          folder: "INBOX",
          mutationsAttempted: 0,
        },
        rulesetPatch: {
          changelog: expect.any(String),
        },
      },
    });
    expect(result.json.result.rulesetPatch.renderedDraft).toBeUndefined();
    const traceText = await readFile(join(traceRoot, "logs", "runs", "cli-high-yield-test.jsonl"), "utf8");
    expect(traceText).toContain("\"command\":\"high-yield\"");
    const summary = await readFile(join(traceRoot, "artifacts", "e2e", "cli-high-yield-test", "summary.md"), "utf8");
    expect(summary).toContain("# QFerry CLI Audit cli-high-yield-test");
    expect(summary).toContain("- mutationsAttempted: 0");
  });

  it("dry-runs a ruleset patch compactly unless rendered draft is requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-cli-rules-"));
    const rulesFile = join(dir, "qferry.rules.json");
    const patchFile = join(dir, "patch.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "test-rules",
      defaultGroupId: "review",
      groups: [{ id: "review", label: "Review" }],
      rules: [],
    }), "utf8");
    await writeFile(patchFile, JSON.stringify({
      groupToEnsure: { id: "ads", label: "Ads", target: { folder: "Ads" } },
      candidateRuleCount: 1,
      rulesToAdd: [{ id: "sender-domain-example-com", groupId: "ads", match: { fromDomainIncludes: "example.com" } }],
      skippedDuplicateRules: [],
    }), "utf8");

    const compact = await invoke(["apply-ruleset-patch", "--rules-file", rulesFile, "--patch-file", patchFile]);
    const verbose = await invoke([
      "apply-ruleset-patch",
      "--rules-file",
      rulesFile,
      "--patch-file",
      patchFile,
      "--include-rendered-draft",
    ]);

    expect(compact.code).toBe(0);
    expect(compact.json.result.renderedDraft).toBeUndefined();
    expect(compact.json.result).toMatchObject({
      applied: false,
      addedRuleCount: 1,
    });
    expect(verbose.code).toBe(0);
    expect(verbose.json.result.renderedDraft.rules).toHaveLength(1);
  });

  it("runs a campaign workflow with dry-run ruleset patch and preview audit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-cli-workflow-"));
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-cli-workflow-trace-"));
    const rulesFile = join(dir, "qferry.rules.json");
    const workflowFile = join(dir, "workflow.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "workflow-test-rules",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
      ],
      rules: [{ id: "newsletter", groupId: "bulk_platform", match: { fromIncludes: "newsletter@" } }],
    }), "utf8");
    await writeFile(workflowFile, JSON.stringify({
      runId: "cli-campaign-workflow-test",
      folders: ["INBOX", "Archive"],
      pageSize: 50,
      maxPagesPerFolder: 1,
      minMessageCount: 1,
      maxCandidatesPerFolder: 3,
      maxDistinctSendersForDomainRule: 3,
      maxConcurrentFolders: 2,
      rulesFile,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
      applyRulesetPatch: false,
      preview: {
        enabled: true,
        action: "move",
        maxMessageRefsPerGroup: 5,
        selectedGroupIds: ["bulk_platform"],
        maxUnplannedHintsPerFolder: 2,
      },
    }), "utf8");

    const result = await invoke(["campaign-workflow", "--input", workflowFile], {
      cwd: dir,
      env: { QFERRY_CLI_TRACE_ROOT: traceRoot },
    });

    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({
      ok: true,
      command: "campaign-workflow",
      runId: "cli-campaign-workflow-test",
      result: {
        workflow: {
          discovery: {
            campaign: {
              mutationsAttempted: 0,
            },
          },
          rulesetPatch: {
            applied: false,
            addedRuleCount: expect.any(Number),
          },
          preview: {
            campaign: {
              mutationsAttempted: 0,
            },
          },
          mutationsAttempted: 0,
        },
      },
    });
    expect(result.json.result.workflow.rulesetPatch.addedRuleCount).toBeGreaterThan(0);
    const traceText = await readFile(join(traceRoot, "logs", "runs", "cli-campaign-workflow-test.jsonl"), "utf8");
    expect(traceText).toContain("\"command\":\"campaign-workflow\"");
    const summary = await readFile(join(traceRoot, "artifacts", "e2e", "cli-campaign-workflow-test", "summary.md"), "utf8");
    expect(summary).toContain("- mutationsAttempted: 0");
    expect(summary).toContain("- workflowPhases: discovery -> ruleset_patch -> preview");
    expect(summary).toContain("- rulesToAdd:");
    expect(summary).toContain("- campaignReport:");
  });

  it("can apply a campaign workflow patch to only the local rules file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-cli-workflow-apply-"));
    const rulesFile = join(dir, "qferry.rules.json");
    const workflowFile = join(dir, "workflow.json");
    await writeFile(rulesFile, JSON.stringify({
      version: "workflow-apply-test-rules",
      defaultGroupId: "review",
      groups: [
        { id: "review", label: "Review" },
        { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
      ],
      rules: [{ id: "newsletter", groupId: "bulk_platform", match: { fromIncludes: "newsletter@" } }],
    }), "utf8");
    await writeFile(workflowFile, JSON.stringify({
      runId: "cli-campaign-workflow-apply-test",
      folders: ["INBOX"],
      pageSize: 50,
      maxPagesPerFolder: 1,
      minMessageCount: 1,
      maxCandidatesPerFolder: 3,
      maxDistinctSendersForDomainRule: 3,
      rulesFile,
      ruleGroup: { id: "bulk_platform", label: "Bulk platform", target: { folder: "Bulk platform" } },
      applyRulesetPatch: true,
      preview: {
        enabled: true,
        action: "move",
        maxMessageRefsPerGroup: 5,
        selectedGroupIds: ["bulk_platform"],
      },
    }), "utf8");

    const result = await invoke(["campaign-workflow", "--input", workflowFile], { cwd: dir });

    expect(result.code).toBe(0);
    expect(result.json.result.workflow.rulesetPatch.applied).toBe(true);
    expect(result.json.result.workflow.mutationsAttempted).toBe(0);
    const writtenRuleset = JSON.parse(await readFile(rulesFile, "utf8"));
    expect(writtenRuleset.rules.length).toBeGreaterThan(1);
  });

  it("rejects campaign workflow preview without a rules file and writes failure audit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-cli-workflow-invalid-"));
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-cli-workflow-invalid-trace-"));
    const workflowFile = join(dir, "workflow.json");
    await writeFile(workflowFile, JSON.stringify({
      runId: "cli-campaign-workflow-invalid-test",
      folders: ["INBOX"],
      pageSize: 50,
      maxPagesPerFolder: 1,
      preview: { enabled: true },
    }), "utf8");

    const result = await invoke(["campaign-workflow", "--input", workflowFile], {
      cwd: dir,
      env: { QFERRY_CLI_TRACE_ROOT: traceRoot },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("campaign-workflow preview requires rulesFile");
    expect(result.stderr).toContain("cli-campaign-workflow-invalid-test");
    const traceText = await readFile(join(traceRoot, "logs", "runs", "cli-campaign-workflow-invalid-test.jsonl"), "utf8");
    expect(traceText).toContain("\"command\":\"campaign-workflow\"");
    expect(traceText).toContain("\"error\":\"campaign-workflow preview requires rulesFile\"");
    const summary = await readFile(join(traceRoot, "artifacts", "e2e", "cli-campaign-workflow-invalid-test", "summary.md"), "utf8");
    expect(summary).toContain("- workflowPhases: failed");
    expect(summary).toContain("- mutationsAttempted: 0");
  });

  it("rejects unsafe run ids before writing audit paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-cli-unsafe-runid-"));
    const traceRoot = await mkdtemp(join(tmpdir(), "qferry-cli-unsafe-runid-trace-"));
    const workflowFile = join(dir, "workflow.json");
    await writeFile(workflowFile, JSON.stringify({
      runId: "../outside",
      folders: ["INBOX"],
      pageSize: 50,
      maxPagesPerFolder: 1,
      preview: { enabled: false },
    }), "utf8");

    const result = await invoke(["campaign-workflow", "--input", workflowFile], {
      cwd: dir,
      env: { QFERRY_CLI_TRACE_ROOT: traceRoot },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("QFerry runId may only contain letters, numbers, dot, underscore, and dash");
    await expect(readFile(join(traceRoot, "logs", "outside.jsonl"), "utf8")).rejects.toThrow();
  });

  it("validates campaign workflow runtime input before scanning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qferry-cli-invalid-workflow-"));
    const workflowFile = join(dir, "workflow.json");
    await writeFile(workflowFile, JSON.stringify({
      folders: [],
      pageSize: "50",
      maxPagesPerFolder: 1,
      preview: {
        enabled: true,
        action: "delete",
      },
    }), "utf8");

    const result = await invoke(["campaign-workflow", "--input", workflowFile], { cwd: dir });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("campaign-workflow folders must contain at least one folder");
  });
});
