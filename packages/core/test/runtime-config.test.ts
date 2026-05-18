import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadQFerryRuntimeConfig, loadQFerryRuntimeSecretsSync } from "../src/runtime-config.js";

describe("runtime config", () => {
  it("defaults to fixture with read-only safety limits", async () => {
    const config = await loadQFerryRuntimeConfig({
      env: {},
      readFile: async () => undefined,
    });

    expect(config).toMatchObject({
      provider: "fixture",
      accountAlias: "demo",
      configSource: "defaults",
      mutationAllowed: false,
      mutationCapable: false,
      mutationRequiresConfirmation: false,
      metadataSampleLimit: 1,
      statusWarnings: [],
    });
  });

  it("loads QQ read-only settings from env without serializing secrets", async () => {
    const config = await loadQFerryRuntimeConfig({
      env: {
        QFERRY_PROVIDER: "qqmail",
        QQMAIL_EMAIL: "25abc@qq.com",
        QQMAIL_KEY: "secret-auth-code",
        QQMAIL_METADATA_SAMPLE_LIMIT: "3",
      },
      readFile: async () => undefined,
    });

    expect(config.provider).toBe("qqmail");
    expect(config.accountAlias).toBe("25***@qq.com");
    expect(config.configSource).toBe("env");
    expect(config.mutationAllowed).toBe(true);
    expect(config.mutationCapable).toBe(true);
    expect(config.authConfigured).toBe(true);
    expect(config.providerReady).toBe(true);
    expect(config.mutationOperationallyReady).toBe(true);
    expect(config.mutationRequiresConfirmation).toBe(true);
    expect(config.metadataSampleLimit).toBe(3);
    expect(config.qqmail).toMatchObject({
      email: "25abc@qq.com",
      authCodePresent: true,
      imapHost: "imap.qq.com",
      imapPort: 993,
    });
    expect(JSON.stringify(config)).not.toContain("secret-auth-code");
  });

  it("does not require an extra env gate beyond MCP destructive-tool approval", async () => {
    const config = await loadQFerryRuntimeConfig({
      env: { QFERRY_PROVIDER: "qqmail", QQMAIL_EMAIL: "25abc@qq.com", QQMAIL_KEY: "secret" },
      readFile: async () => undefined,
    });

    expect(config.mutationAllowed).toBe(true);
    expect(config.mutationCapable).toBe(true);
    expect(config.mutationRequiresConfirmation).toBe(true);
    expect(JSON.stringify(config)).not.toContain("secret");
  });

  it("loads QQ settings from the local app env file when process env is missing", async () => {
    const config = await loadQFerryRuntimeConfig({
      env: { QFERRY_ENV_FILE: "C:\\Users\\me\\AppData\\Local\\qferry\\.env" },
      readFile: async (path) => {
        if (path.endsWith(".env")) {
          return [
            "QFERRY_PROVIDER=qqmail",
            "QQMAIL_EMAIL=25abc@qq.com",
            "QQMAIL_KEY=secret-auth-code",
            "QQMAIL_METADATA_SAMPLE_LIMIT=5",
          ].join("\n");
        }
        return undefined;
      },
    });

    expect(config.provider).toBe("qqmail");
    expect(config.configSource).toBe("env-file:C:\\Users\\me\\AppData\\Local\\qferry\\.env");
    expect(config.accountAlias).toBe("25***@qq.com");
    expect(config.metadataSampleLimit).toBe(5);
    expect(config.qqmail?.authCodePresent).toBe(true);
    expect(JSON.stringify(config)).not.toContain("secret-auth-code");
  });

  it("loads QQ classification parent path from env", async () => {
    const config = await loadQFerryRuntimeConfig({
      env: {
        QFERRY_PROVIDER: "qqmail",
        QQMAIL_EMAIL: "25abc@qq.com",
        QQMAIL_KEY: "secret-auth-code",
        QQMAIL_CLASSIFICATION_PARENT_PATH: "User Folders",
        QFERRY_RULES_FILE: "G:\\local\\qferry.rules.json",
      },
      readFile: async () => undefined,
    });

    expect(config.qqmail?.classificationParentPath).toBe("User Folders");
    expect(config.rulesFile).toBe("G:\\local\\qferry.rules.json");
    expect(JSON.stringify(config)).not.toContain("secret-auth-code");
  });

  it("loads QQ auth code from the same local env source without adding it to status config", () => {
    const dir = mkdtempSync(join(tmpdir(), "qferry-runtime-secrets-"));
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "QQMAIL_KEY=secret-auth-code\n", "utf8");

    const secrets = loadQFerryRuntimeSecretsSync({
      QFERRY_ENV_FILE: envFile,
    });

    expect(secrets.qqmailKey).toBe("secret-auth-code");
  });

  it("loads local JSON config when env provider is not set", async () => {
    const config = await loadQFerryRuntimeConfig({
      env: { QFERRY_CONFIG_FILE: "G:\\local\\qferry-config.json" },
      readFile: async (path) => {
        if (path.endsWith(".env")) return undefined;
        expect(path).toBe("G:\\local\\qferry-config.json");
        return JSON.stringify({
          provider: "qqmail",
          qqmail: {
            email: "local@qq.com",
            imapHost: "imap.qq.com",
            imapPort: 993,
            metadataSampleLimit: 7,
            classificationParentPath: "Local Folders",
          },
          rulesFile: "G:\\local\\qferry.rules.json",
        });
      },
    });

    expect(config.provider).toBe("qqmail");
    expect(config.accountAlias).toBe("lo***@qq.com");
    expect(config.configSource).toBe("file:G:\\local\\qferry-config.json");
    expect(config.metadataSampleLimit).toBe(7);
    expect(config.qqmail?.classificationParentPath).toBe("Local Folders");
    expect(config.rulesFile).toBe("G:\\local\\qferry.rules.json");
    expect(config.authConfigured).toBe(false);
    expect(config.providerReady).toBe(false);
    expect(config.mutationOperationallyReady).toBe(false);
    expect(config.mutationCapable).toBe(false);
    expect(config.statusWarnings).toContain("QQMAIL_KEY is required for qqmail provider");
  });

  it("lets env override local JSON provider settings", async () => {
    const config = await loadQFerryRuntimeConfig({
      env: {
        QFERRY_CONFIG_FILE: "G:\\local\\qferry-config.json",
        QFERRY_PROVIDER: "fixture",
      },
      readFile: async (path) => {
        if (path.endsWith(".env")) return undefined;
        return JSON.stringify({
          provider: "qqmail",
          qqmail: { email: "local@qq.com", metadataSampleLimit: 7 },
        });
      },
    });

    expect(config.provider).toBe("fixture");
    expect(config.accountAlias).toBe("demo");
    expect(config.configSource).toBe("env");
  });

  it("clamps metadata sample limits to the safe read-only range", async () => {
    const high = await loadQFerryRuntimeConfig({
      env: { QFERRY_PROVIDER: "qqmail", QQMAIL_EMAIL: "a@qq.com", QQMAIL_KEY: "secret", QQMAIL_METADATA_SAMPLE_LIMIT: "100" },
      readFile: async () => undefined,
    });
    const low = await loadQFerryRuntimeConfig({
      env: { QFERRY_PROVIDER: "qqmail", QQMAIL_EMAIL: "a@qq.com", QQMAIL_KEY: "secret", QQMAIL_METADATA_SAMPLE_LIMIT: "0" },
      readFile: async () => undefined,
    });

    expect(high.metadataSampleLimit).toBe(50);
    expect(low.metadataSampleLimit).toBe(1);
  });
});
