import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JsonlTraceWriter, createRunId } from "@qferry/core";

import { createQFerryMcpServer } from "../mcp-server.js";

export interface FixtureMcpE2EInput {
  projectRoot: string;
  runId?: string;
}

export interface FixtureMcpE2EResult {
  provider: "fixture";
  runId: string;
  mutationsAttempted: number;
  artifacts: {
    tracePath: string;
    summaryPath: string;
  };
}

export async function runFixtureMcpE2E(input: FixtureMcpE2EInput): Promise<FixtureMcpE2EResult> {
  const runId = input.runId ?? createRunId("fixture-mcp-e2e");
  const artifactDir = join(input.projectRoot, "artifacts", "e2e", runId);
  const tracePath = join(input.projectRoot, "logs", "runs", `${runId}.jsonl`);
  const summaryPath = join(artifactDir, "summary.md");
  const trace = new JsonlTraceWriter(tracePath);
  const baseEvent = {
    runId,
    provider: "fixture",
    surface: "chatgpt-app-mcp",
    dryRun: true,
  };

  await mkdir(artifactDir, { recursive: true });
  await trace.write({ ...baseEvent, event: "mcp_fixture_e2e_started" });

  const previousProvider = process.env.QFERRY_PROVIDER;
  const previousEnvFile = process.env.QFERRY_ENV_FILE;
  process.env.QFERRY_PROVIDER = "fixture";
  process.env.QFERRY_ENV_FILE = join(input.projectRoot, "missing-qferry.env");
  const server = createQFerryMcpServer();
  restoreFixtureEnv(previousProvider, previousEnvFile);
  const client = new Client({ name: "qferry-fixture-e2e", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const tools = await client.listTools();
  await trace.write({ ...baseEvent, event: "mcp_tools_listed", toolCount: tools.tools.length });

  await callToolWithTrace(trace, baseEvent, client, "list_mailboxes", {});
  await callToolWithTrace(trace, baseEvent, client, "search", { folder: "INBOX", limit: 10, query: "digest" });
  const planResult = await callToolWithTrace(trace, baseEvent, client, "plan_cleanup", {
    runId,
    folder: "INBOX",
    limit: 10,
    action: "move",
    target: { folder: "Archive" },
    rules: [
      { id: "newsletter", groupId: "archive", match: { fromIncludes: "newsletter@" } },
    ],
    selectedGroupIds: ["archive"],
  });
  const plan = (planResult.structuredContent as { plan?: unknown } | undefined)?.plan;
  if (!plan) {
    throw new Error("plan_cleanup did not return a plan");
  }
  const blockedExecute = await client.callTool({
    name: "execute_cleanup",
    arguments: { plan },
  });
  if (!blockedExecute.isError) {
    throw new Error("execute_cleanup should be blocked in fixture e2e until the plan is confirmed");
  }
  await trace.write({ ...baseEvent, event: "mcp_tool_blocked", toolName: "execute_cleanup", mutationsAttempted: 0 });

  await client.close();
  await server.close();

  const summary = [
    `# QFerry Fixture MCP E2E ${runId}`,
    "",
    "- provider: fixture",
    "- surface: chatgpt-app-mcp",
    "- dryRun: true",
    "- mutationsAttempted: 0",
    "- toolsCalled: 4",
    "- executeCleanupBlocked: true",
    `- trace: ${tracePath}`,
    "",
  ].join("\n");
  await writeFile(summaryPath, summary, "utf8");
  await trace.write({ ...baseEvent, event: "mcp_fixture_e2e_finished", ok: true, mutationsAttempted: 0 });

  return {
    provider: "fixture",
    runId,
    mutationsAttempted: 0,
    artifacts: { tracePath, summaryPath },
  };
}

function restoreFixtureEnv(previousProvider: string | undefined, previousEnvFile: string | undefined): void {
  if (previousProvider === undefined) {
    delete process.env.QFERRY_PROVIDER;
  } else {
    process.env.QFERRY_PROVIDER = previousProvider;
  }
  if (previousEnvFile === undefined) {
    delete process.env.QFERRY_ENV_FILE;
  } else {
    process.env.QFERRY_ENV_FILE = previousEnvFile;
  }
}

async function callToolWithTrace(
  trace: JsonlTraceWriter,
  baseEvent: Record<string, unknown>,
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Awaited<ReturnType<Client["callTool"]>>> {
  const result = await client.callTool({ name, arguments: args });
  await trace.write({
    ...baseEvent,
    event: "mcp_tool_called",
    toolName: name,
    structuredContentKeys: Object.keys(result.structuredContent ?? {}),
  });
  return result;
}

async function main(): Promise<void> {
  const projectRootArgIndex = process.argv.indexOf("--project-root");
  const projectRoot = projectRootArgIndex >= 0
    ? join(process.cwd(), process.argv[projectRootArgIndex + 1] ?? ".")
    : process.cwd();
  const result = await runFixtureMcpE2E({ projectRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
