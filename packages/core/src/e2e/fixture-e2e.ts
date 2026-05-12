import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createOperationPlan } from "../operation-plan.js";
import { FixtureMailProvider } from "../providers/fixture-provider.js";
import { JsonlTraceWriter, createRunId } from "../trace.js";

export interface FixtureE2EInput {
  projectRoot: string;
  runId?: string;
}

export interface FixtureE2EResult {
  provider: "fixture";
  runId: string;
  mutationsAttempted: number;
  artifacts: {
    tracePath: string;
    summaryPath: string;
    operationPlanPath: string;
  };
}

export async function runFixtureE2E(input: FixtureE2EInput): Promise<FixtureE2EResult> {
  const runId = input.runId ?? createRunId("fixture-e2e");
  const artifactDir = join(input.projectRoot, "artifacts", "e2e", runId);
  const tracePath = join(input.projectRoot, "logs", "runs", `${runId}.jsonl`);
  const summaryPath = join(artifactDir, "summary.md");
  const operationPlanPath = join(artifactDir, "operation-plan.json");

  const trace = new JsonlTraceWriter(tracePath);
  const provider = FixtureMailProvider.demo();
  const baseEvent = {
    runId,
    provider: "fixture",
    dryRun: true,
    mutationAllowed: false,
  };

  await mkdir(artifactDir, { recursive: true });
  await trace.write({ ...baseEvent, event: "fixture_e2e_started" });

  const mailboxes = await provider.listMailboxes();
  await trace.write({ ...baseEvent, event: "mailboxes_listed", mailboxCount: mailboxes.length });

  const messages = await provider.scanMailboxMetadata({ folder: "INBOX", limit: 2 });
  await trace.write({ ...baseEvent, event: "metadata_scanned", messageCount: messages.length });

  const plan = createOperationPlan({
    runId,
    provider: "fixture",
    action: "move",
    messageRefs: messages.slice(1).map((message) => message.ref),
    target: { folder: "Archive" },
  });
  await writeFile(operationPlanPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await trace.write({
    ...baseEvent,
    event: "operation_plan_created",
    operationPlanId: plan.operationPlanId,
    action: plan.action,
    plannedMessages: plan.messageRefs.length,
  });

  const summary = [
    `# QFerry Fixture E2E ${runId}`,
    "",
    "- provider: fixture",
    "- dryRun: true",
    "- mutationAllowed: false",
    "- mutationsAttempted: 0",
    `- mailboxes: ${mailboxes.length}`,
    `- scannedMessages: ${messages.length}`,
    `- operationPlanId: ${plan.operationPlanId}`,
    `- trace: ${tracePath}`,
    `- operationPlan: ${operationPlanPath}`,
    "",
  ].join("\n");
  await writeFile(summaryPath, summary, "utf8");

  await trace.write({ ...baseEvent, event: "fixture_e2e_finished", ok: true, mutationsAttempted: 0 });

  return {
    provider: "fixture",
    runId,
    mutationsAttempted: 0,
    artifacts: {
      tracePath,
      summaryPath,
      operationPlanPath,
    },
  };
}

async function main(): Promise<void> {
  const projectRootArgIndex = process.argv.indexOf("--project-root");
  const projectRoot = projectRootArgIndex >= 0
    ? join(process.cwd(), process.argv[projectRootArgIndex + 1] ?? ".")
    : process.cwd();
  const result = await runFixtureE2E({ projectRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
