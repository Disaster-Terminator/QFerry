import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runFixtureMcpE2E } from "../src/e2e/fixture-mcp-e2e.js";

describe("fixture MCP e2e", () => {
  it("writes trace and summary artifacts for tool calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "qferry-fixture-mcp-e2e-"));

    const result = await runFixtureMcpE2E({ projectRoot: root, runId: "fixture-mcp-test-run" });

    expect(result.provider).toBe("fixture");
    expect(result.mutationsAttempted).toBe(0);

    const trace = await readFile(result.artifacts.tracePath, "utf8");
    expect(trace).toContain("mcp_fixture_e2e_started");
    expect(trace).toContain("mcp_tool_called");
    expect(trace).toContain("mcp_fixture_e2e_finished");

    const summary = await readFile(result.artifacts.summaryPath, "utf8");
    expect(summary).toContain("provider: fixture");
    expect(summary).toContain("toolsCalled: 3");
    expect(summary).toContain("mutationsAttempted: 0");
  });
});
