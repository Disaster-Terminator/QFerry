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
});
