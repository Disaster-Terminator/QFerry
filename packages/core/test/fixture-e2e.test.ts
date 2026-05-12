import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runFixtureE2E } from "../src/e2e/fixture-e2e.js";

describe("fixture e2e", () => {
  it("writes trace, summary, and operation plan artifacts without real provider mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "qferry-fixture-e2e-"));

    const result = await runFixtureE2E({ projectRoot: root, runId: "fixture-test-run" });

    expect(result.provider).toBe("fixture");
    expect(result.mutationsAttempted).toBe(0);
    expect(result.artifacts.summaryPath).toContain("summary.md");
    expect(result.artifacts.capabilitySnapshotPath).toContain("capability-snapshot.json");

    const trace = await readFile(result.artifacts.tracePath, "utf8");
    expect(trace).toContain("fixture_e2e_started");
    expect(trace).toContain("operation_plan_created");
    expect(trace).toContain("fixture_e2e_finished");

    const summary = await readFile(result.artifacts.summaryPath, "utf8");
    expect(summary).toContain("provider: fixture");
    expect(summary).toContain("mutationsAttempted: 0");

    const operationPlan = await readFile(result.artifacts.operationPlanPath, "utf8");
    expect(operationPlan).toContain('"status": "preview"');
    expect(operationPlan).toContain('"action": "move"');
    expect(operationPlan).not.toContain("fixture full body");

    const capabilitySnapshot = await readFile(result.artifacts.capabilitySnapshotPath, "utf8");
    expect(capabilitySnapshot).toContain('"provider": "fixture"');
    expect(capabilitySnapshot).toContain('"supportsMutation": false');
  });
});
