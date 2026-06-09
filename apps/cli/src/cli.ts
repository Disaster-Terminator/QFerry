#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyRulesetPatchDraft,
  createMailProviderFromRuntimeConfig,
  createMailTools,
  createRunId,
  loadQFerryRuntimeConfigSync,
  type ClassificationGroup,
  type HighYieldGovernanceInput,
  type MailboxGovernanceCampaignInput,
  type RulesetGovernanceCampaignPreviewInput,
  type RulesetGovernancePreviewInput,
} from "@qferry/core";
import { writeCliAudit } from "./audit.js";

export interface CliRunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
}

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean | string[]>;
}

type CliResult = Record<string, unknown>;

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 1;

export async function runCli(args: string[] = process.argv.slice(2), options: CliRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = options.stderr ?? ((chunk) => process.stderr.write(chunk));
  const cwd = options.cwd ?? process.cwd();
  const env = { ...process.env, ...options.env };

  try {
    const parsed = parseArgs(args);
    if (parsed.command === "help" || parsed.flags.help === true) {
      stdout(`${usage()}\n`);
      return 0;
    }

    const runtimeConfig = loadQFerryRuntimeConfigSync(env);
    const provider = createMailProviderFromRuntimeConfig(runtimeConfig, { env });
    const tools = createMailTools({ provider, runtimeConfig });
    let runId: string | undefined;
    let cliInput: Record<string, unknown> = {};
    let result: CliResult;

    switch (parsed.command) {
      case "status":
        result = await tools.getStatus();
        break;
      case "list-mailboxes":
        result = await tools.listMailboxes();
        break;
      case "mailbox-summary":
        cliInput = { folder: requiredString(parsed.flags, "folder") };
        result = await tools.getMailboxSummary(cliInput as { folder: string });
        break;
      case "high-yield": {
        runId = optionalString(parsed.flags, "run-id") ?? createRunId("qferry-cli-high-yield");
        const input = highYieldInput(parsed.flags);
        cliInput = { ...input, runId };
        result = await tools.planHighYieldGovernance(input);
        break;
      }
      case "mailbox-campaign": {
        runId = optionalString(parsed.flags, "run-id") ?? createRunId("qferry-cli-mailbox-campaign");
        const input = await jsonInput<MailboxGovernanceCampaignInput>(cwd, parsed.flags);
        cliInput = { ...input, runId };
        result = await tools.planMailboxGovernanceCampaign(input);
        break;
      }
      case "ruleset-preview": {
        const input = await jsonInput<RulesetGovernancePreviewInput>(cwd, parsed.flags);
        runId = optionalString(parsed.flags, "run-id") ?? input.runId ?? createRunId("qferry-cli-ruleset-preview");
        const resolvedInput = { ...input, runId };
        cliInput = resolvedInput;
        result = compactRulesetGovernancePreview(await tools.rulesetGovernancePreview(resolvedInput), hasFlag(parsed.flags, "include-classifications"));
        break;
      }
      case "ruleset-campaign-preview": {
        const input = await jsonInput<RulesetGovernanceCampaignPreviewInput>(cwd, parsed.flags);
        runId = optionalString(parsed.flags, "run-id") ?? input.runId ?? createRunId("qferry-cli-ruleset-campaign");
        const resolvedInput = { ...input, runId };
        cliInput = resolvedInput;
        result = compactRulesetGovernanceCampaignPreview(await tools.rulesetGovernanceCampaignPreview(resolvedInput));
        break;
      }
      case "apply-ruleset-patch": {
        const rulesFile = requiredString(parsed.flags, "rules-file");
        const patchFile = requiredString(parsed.flags, "patch-file");
        const patch = await readJson(resolvePath(cwd, patchFile));
        cliInput = {
          rulesFile,
          patchFile,
          apply: hasFlag(parsed.flags, "apply"),
          includeRenderedDraft: hasFlag(parsed.flags, "include-rendered-draft"),
        };
        result = await applyRulesetPatchDraft({
          rulesFile,
          patch: patch as never,
          apply: hasFlag(parsed.flags, "apply"),
          includeRenderedDraft: hasFlag(parsed.flags, "include-rendered-draft"),
        }) as unknown as CliResult;
        break;
      }
      default:
        throw new Error(`Unknown QFerry CLI command: ${parsed.command || "<missing>"}`);
    }

    const audit = runId
      ? await writeCliAudit({
          root: env.QFERRY_CLI_TRACE_ROOT?.trim() || env.QFERRY_MCP_TRACE_ROOT?.trim() || cwd,
          runId,
          command: parsed.command,
          cliInput,
          result,
        })
      : undefined;

    stdout(`${JSON.stringify({
      ok: true,
      command: parsed.command,
      ...(runId ? { runId } : {}),
      ...(audit ? { audit } : {}),
      result,
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr(`${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`);
    return 1;
  }
}

function parseArgs(args: string[]): ParsedArgs {
  if (args[0] === "--") {
    return parseArgs(args.slice(1));
  }
  const [command = "help", ...rest] = args;
  const flags: ParsedArgs["flags"] = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const rawName = token.slice(2);
    const equalsIndex = rawName.indexOf("=");
    const name = equalsIndex >= 0 ? rawName.slice(0, equalsIndex) : rawName;
    const inlineValue = equalsIndex >= 0 ? rawName.slice(equalsIndex + 1) : undefined;
    const next = rest[index + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? rest[++index] : true);
    appendFlag(flags, name, value);
  }
  return { command, flags };
}

function appendFlag(flags: ParsedArgs["flags"], name: string, value: string | boolean): void {
  const existing = flags[name];
  if (existing === undefined) {
    flags[name] = value;
  } else if (Array.isArray(existing)) {
    existing.push(String(value));
  } else {
    flags[name] = [String(existing), String(value)];
  }
}

function highYieldInput(flags: ParsedArgs["flags"]): HighYieldGovernanceInput {
  const ruleGroup = optionalRuleGroup(flags);
  return {
    folder: requiredString(flags, "folder"),
    pageSize: optionalInteger(flags, "page-size") ?? DEFAULT_PAGE_SIZE,
    maxPages: optionalInteger(flags, "max-pages") ?? DEFAULT_MAX_PAGES,
    ...(optionalInteger(flags, "scan-offset") !== undefined ? { scanOffset: optionalInteger(flags, "scan-offset") } : {}),
    ...(optionalString(flags, "order") ? { order: orderFlag(flags) } : {}),
    ...(optionalInteger(flags, "min-message-count") !== undefined ? { minMessageCount: optionalInteger(flags, "min-message-count") } : {}),
    ...(optionalInteger(flags, "max-candidates") !== undefined ? { maxCandidates: optionalInteger(flags, "max-candidates") } : {}),
    ...(optionalInteger(flags, "max-distinct-senders-for-domain-rule") !== undefined
      ? { maxDistinctSendersForDomainRule: optionalInteger(flags, "max-distinct-senders-for-domain-rule") }
      : {}),
    ...(ruleGroup ? { ruleGroup } : {}),
    ...(optionalString(flags, "rules-file") ? { rulesFile: optionalString(flags, "rules-file") } : {}),
  };
}

function optionalRuleGroup(flags: ParsedArgs["flags"]): ClassificationGroup | undefined {
  const id = optionalString(flags, "group-id");
  const label = optionalString(flags, "group-label");
  const targetFolder = optionalString(flags, "target-folder");
  if (!id && !label && !targetFolder) return undefined;
  if (!id || !label) {
    throw new Error("--group-id and --group-label must be passed together");
  }
  return {
    id,
    label,
    ...(targetFolder ? { target: { folder: targetFolder } } : {}),
  };
}

async function jsonInput<T>(cwd: string, flags: ParsedArgs["flags"]): Promise<T> {
  const inputPath = requiredString(flags, "input");
  return await readJson(resolvePath(cwd, inputPath)) as T;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function compactRulesetGovernancePreview<T extends { classifications?: unknown[] }>(
  result: T,
  includeClassifications: boolean,
): T | Omit<T, "classifications"> {
  if (includeClassifications) return result;
  const { classifications: _classifications, ...compact } = result;
  return compact;
}

function compactRulesetGovernanceCampaignPreview<T extends { plans?: unknown[] }>(
  result: T,
): Omit<T, "plans"> {
  const { plans: _plans, ...compact } = result;
  return compact;
}

function requiredString(flags: ParsedArgs["flags"], name: string): string {
  const value = optionalString(flags, name);
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

function optionalString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  if (value === undefined || value === false) return undefined;
  if (Array.isArray(value)) return value[value.length - 1];
  if (value === true) return "true";
  return value;
}

function optionalInteger(flags: ParsedArgs["flags"], name: string): number | undefined {
  const value = optionalString(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Flag --${name} must be an integer`);
  }
  return parsed;
}

function orderFlag(flags: ParsedArgs["flags"]): "newest" | "oldest" {
  const value = requiredString(flags, "order");
  if (value !== "newest" && value !== "oldest") {
    throw new Error("--order must be newest or oldest");
  }
  return value;
}

function hasFlag(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

function resolvePath(cwd: string, path: string): string {
  return resolve(cwd, path);
}

function usage(): string {
  return [
    "QFerry CLI",
    "",
    "Usage:",
    "  qferry status",
    "  qferry list-mailboxes",
    "  qferry mailbox-summary --folder INBOX",
    "  qferry high-yield --folder INBOX --page-size 50 --max-pages 2 --group-id ads --group-label Ads --target-folder Ads",
    "  qferry mailbox-campaign --input campaign.json",
    "  qferry ruleset-preview --input preview.json",
    "  qferry ruleset-campaign-preview --input campaign-preview.json",
    "  qferry apply-ruleset-patch --rules-file qferry.rules.json --patch-file patch.json [--apply]",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
