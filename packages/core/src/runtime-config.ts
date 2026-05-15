import { readFile as defaultReadFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type QFerryProviderName = "fixture" | "qqmail";

export interface QFerryRuntimeConfig {
  provider: QFerryProviderName;
  accountAlias: string;
  configSource: string;
  mutationAllowed: boolean;
  mutationCapable: boolean;
  mutationOperationallyReady: boolean;
  mutationRequiresConfirmation: boolean;
  authConfigured: boolean;
  providerReady: boolean;
  metadataSampleLimit: number;
  statusWarnings: string[];
  qqmail?: {
    email?: string;
    authCodePresent: boolean;
    imapHost: string;
    imapPort: number;
  };
}

export interface LoadQFerryRuntimeConfigInput {
  env?: Record<string, string | undefined>;
  readFile?: (path: string) => Promise<string | undefined>;
}

export interface QFerryRuntimeSecrets {
  qqmailKey?: string;
}

interface LocalConfigFile {
  provider?: string;
  qqmail?: {
    email?: string;
    imapHost?: string;
    imapPort?: number;
    metadataSampleLimit?: number;
  };
}

export async function loadQFerryRuntimeConfig(input: LoadQFerryRuntimeConfigInput = {}): Promise<QFerryRuntimeConfig> {
  const processEnv = input.env ?? process.env;
  const readFile = input.readFile ?? readConfigFile;
  const envFilePath = processEnv.QFERRY_ENV_FILE?.trim() || defaultEnvFilePath();
  const envFile = await loadEnvFile(envFilePath, readFile);
  const env = { ...envFile.values, ...processEnv };
  const localConfigPath = env.QFERRY_CONFIG_FILE?.trim() || defaultConfigPath();
  const localConfig = await loadLocalConfig(localConfigPath, readFile);
  const envProvider = parseProvider(env.QFERRY_PROVIDER);
  const fileProvider = parseProvider(localConfig.config?.provider);
  const provider = envProvider ?? fileProvider ?? "fixture";
  const configSource = envProvider
    ? processEnv.QFERRY_PROVIDER ? "env" : `env-file:${envFile.path}`
    : localConfig.loaded ? `file:${localConfig.path}` : "defaults";

  if (provider === "fixture") {
    return {
      provider: "fixture",
      accountAlias: "demo",
      configSource,
      mutationAllowed: false,
      mutationCapable: false,
      mutationOperationallyReady: false,
      mutationRequiresConfirmation: false,
      authConfigured: false,
      providerReady: true,
      metadataSampleLimit: 1,
      statusWarnings: [],
    };
  }

  const email = env.QQMAIL_EMAIL?.trim() || localConfig.config?.qqmail?.email?.trim();
  const authCode = env.QQMAIL_KEY;
  const imapHost = env.QQMAIL_IMAP_HOST?.trim() || localConfig.config?.qqmail?.imapHost?.trim() || "imap.qq.com";
  const imapPort = parseInteger(env.QQMAIL_IMAP_PORT) ?? localConfig.config?.qqmail?.imapPort ?? 993;
  const metadataSampleLimit = clampSampleLimit(
    parseInteger(env.QQMAIL_METADATA_SAMPLE_LIMIT)
      ?? parseInteger(env.QFERRY_METADATA_SAMPLE_LIMIT)
      ?? localConfig.config?.qqmail?.metadataSampleLimit
      ?? 1,
  );
  const statusWarnings: string[] = [];
  if (!email) statusWarnings.push("QQMAIL_EMAIL is required for qqmail provider");
  if (!authCode) statusWarnings.push("QQMAIL_KEY is required for qqmail provider");
  const authConfigured = Boolean(email && authCode);

  return {
    provider: "qqmail",
    accountAlias: email ? maskEmail(email) : "<account-missing>",
    configSource,
    mutationAllowed: true,
    mutationCapable: authConfigured,
    mutationOperationallyReady: authConfigured,
    mutationRequiresConfirmation: true,
    authConfigured,
    providerReady: authConfigured,
    metadataSampleLimit,
    statusWarnings,
    qqmail: {
      email,
      authCodePresent: Boolean(authCode),
      imapHost,
      imapPort,
    },
  };
}

export function loadQFerryRuntimeConfigSync(env: Record<string, string | undefined> = process.env): QFerryRuntimeConfig {
  const envFilePath = env.QFERRY_ENV_FILE?.trim() || defaultEnvFilePath();
  const envFile = loadEnvFileSync(envFilePath);
  const mergedEnv = { ...envFile.values, ...env };
  const localConfigPath = mergedEnv.QFERRY_CONFIG_FILE?.trim() || defaultConfigPath();
  const localConfig = loadLocalConfigSync(localConfigPath);
  return buildRuntimeConfig(mergedEnv, localConfig, env.QFERRY_PROVIDER ? "env" : envFile.loaded ? `env-file:${envFile.path}` : undefined);
}

export function loadQFerryRuntimeSecretsSync(env: Record<string, string | undefined> = process.env): QFerryRuntimeSecrets {
  const envFilePath = env.QFERRY_ENV_FILE?.trim() || defaultEnvFilePath();
  const envFile = loadEnvFileSync(envFilePath);
  const mergedEnv = { ...envFile.values, ...env };
  return {
    qqmailKey: mergedEnv.QQMAIL_KEY,
  };
}

async function readConfigFile(filePath: string): Promise<string | undefined> {
  try {
    return await defaultReadFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function loadLocalConfig(
  configPath: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<{ loaded: boolean; path: string; config?: LocalConfigFile }> {
  const text = await readFile(configPath);
  if (!text) return { loaded: false, path: configPath };
  const parsed = JSON.parse(text) as LocalConfigFile;
  return { loaded: true, path: configPath, config: parsed };
}

function loadLocalConfigSync(configPath: string): { loaded: boolean; path: string; config?: LocalConfigFile } {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as LocalConfigFile;
    return { loaded: true, path: configPath, config: parsed };
  } catch {
    return { loaded: false, path: configPath };
  }
}

async function loadEnvFile(
  envFilePath: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<{ loaded: boolean; path: string; values: Record<string, string> }> {
  const text = await readFile(envFilePath);
  return { loaded: Boolean(text), path: envFilePath, values: text ? parseDotenv(text) : {} };
}

function loadEnvFileSync(envFilePath: string): { loaded: boolean; path: string; values: Record<string, string> } {
  try {
    return { loaded: true, path: envFilePath, values: parseDotenv(readFileSync(envFilePath, "utf8")) };
  } catch {
    return { loaded: false, path: envFilePath, values: {} };
  }
}

function buildRuntimeConfig(
  env: Record<string, string | undefined>,
  localConfig: { loaded: boolean; path: string; config?: LocalConfigFile },
  envConfigSource?: string,
): QFerryRuntimeConfig {
  const envProvider = parseProvider(env.QFERRY_PROVIDER);
  const fileProvider = parseProvider(localConfig.config?.provider);
  const provider = envProvider ?? fileProvider ?? "fixture";
  const configSource = envProvider ? envConfigSource ?? "env" : localConfig.loaded ? `file:${localConfig.path}` : "defaults";

  if (provider === "fixture") {
    return {
      provider: "fixture",
      accountAlias: "demo",
      configSource,
      mutationAllowed: false,
      mutationCapable: false,
      mutationOperationallyReady: false,
      mutationRequiresConfirmation: false,
      authConfigured: false,
      providerReady: true,
      metadataSampleLimit: 1,
      statusWarnings: [],
    };
  }

  const email = env.QQMAIL_EMAIL?.trim() || localConfig.config?.qqmail?.email?.trim();
  const authCode = env.QQMAIL_KEY;
  const imapHost = env.QQMAIL_IMAP_HOST?.trim() || localConfig.config?.qqmail?.imapHost?.trim() || "imap.qq.com";
  const imapPort = parseInteger(env.QQMAIL_IMAP_PORT) ?? localConfig.config?.qqmail?.imapPort ?? 993;
  const metadataSampleLimit = clampSampleLimit(
    parseInteger(env.QQMAIL_METADATA_SAMPLE_LIMIT)
      ?? parseInteger(env.QFERRY_METADATA_SAMPLE_LIMIT)
      ?? localConfig.config?.qqmail?.metadataSampleLimit
      ?? 1,
  );
  const statusWarnings: string[] = [];
  if (!email) statusWarnings.push("QQMAIL_EMAIL is required for qqmail provider");
  if (!authCode) statusWarnings.push("QQMAIL_KEY is required for qqmail provider");
  const authConfigured = Boolean(email && authCode);

  return {
    provider: "qqmail",
    accountAlias: email ? maskEmail(email) : "<account-missing>",
    configSource,
    mutationAllowed: true,
    mutationCapable: authConfigured,
    mutationOperationallyReady: authConfigured,
    mutationRequiresConfirmation: true,
    authConfigured,
    providerReady: authConfigured,
    metadataSampleLimit,
    statusWarnings,
    qqmail: {
      email,
      authCodePresent: Boolean(authCode),
      imapHost,
      imapPort,
    },
  };
}

function defaultConfigPath(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), "qferry", "config.json");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "qferry", "config.json");
}

function defaultEnvFilePath(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), "qferry", ".env");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "qferry", ".env");
}

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const delimiter = line.indexOf("=");
    const key = line.slice(0, delimiter).trim();
    const value = line.slice(delimiter + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) values[key] = value;
  }
  return values;
}

function parseProvider(value: string | undefined): QFerryProviderName | undefined {
  if (value === "fixture" || value === "qqmail") return value;
  return undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampSampleLimit(value: number): number {
  return Math.min(Math.max(value, 1), 50);
}

function maskEmail(value: string): string {
  const [name, domain] = value.split("@", 2);
  if (!domain) return "<account-provided>";
  return `${name.slice(0, 2) || "*"}***@${domain}`;
}
