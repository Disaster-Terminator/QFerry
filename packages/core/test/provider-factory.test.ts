import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createMailProviderFromRuntimeConfig } from "../src/provider-factory.js";
import type { QFerryRuntimeConfig } from "../src/runtime-config.js";

function qqConfig(overrides: Partial<QFerryRuntimeConfig> = {}): QFerryRuntimeConfig {
  return {
    provider: "qqmail",
    accountAlias: "qa***@qq.com",
    configSource: "test",
    mutationAllowed: true,
    mutationCapable: true,
    mutationOperationallyReady: true,
    mutationRequiresConfirmation: true,
    authConfigured: true,
    providerReady: true,
    metadataSampleLimit: 7,
    statusWarnings: [],
    qqmail: {
      email: "qa@qq.com",
      authCodePresent: true,
      imapHost: "imap.qq.com",
      imapPort: 993,
    },
    ...overrides,
  };
}

describe("provider factory", () => {
  it("creates the fixture provider for non-QQ runtime config", async () => {
    const provider = createMailProviderFromRuntimeConfig({
      provider: "fixture",
      accountAlias: "demo",
      configSource: "test",
      mutationAllowed: false,
      mutationCapable: false,
      mutationOperationallyReady: false,
      mutationRequiresConfirmation: false,
      authConfigured: false,
      providerReady: true,
      metadataSampleLimit: 1,
      statusWarnings: [],
    });

    const mailboxes = await provider.listMailboxes();

    expect(mailboxes.map((mailbox) => mailbox.path)).toContain("INBOX");
  });

  it("returns an unavailable QQ provider when auth is missing", async () => {
    const missingEnvFile = join(mkdtempSync(join(tmpdir(), "qferry-provider-factory-")), "missing.env");
    const provider = createMailProviderFromRuntimeConfig(qqConfig({
      mutationCapable: false,
      mutationOperationallyReady: false,
      authConfigured: false,
      providerReady: false,
      statusWarnings: ["QQMAIL_KEY is required for qqmail provider"],
      qqmail: {
        email: "qa@qq.com",
        authCodePresent: false,
        imapHost: "imap.qq.com",
        imapPort: 993,
      },
    }), { env: { QFERRY_ENV_FILE: missingEnvFile } });

    await expect(provider.listMailboxes()).rejects.toThrow("QQMAIL_KEY is required for qqmail provider");
    await expect(provider.getCapabilitySnapshot?.()).resolves.toMatchObject({
      provider: "qqmail",
      supportsMutation: false,
      maxRecommendedScanLimit: 7,
    });
  });

  it("creates a QQ provider from runtime config and env secret without exposing the secret", async () => {
    const missingEnvFile = join(mkdtempSync(join(tmpdir(), "qferry-provider-factory-")), "missing.env");
    const provider = createMailProviderFromRuntimeConfig(qqConfig(), {
      env: { QFERRY_ENV_FILE: missingEnvFile, QQMAIL_KEY: "secret-auth-code" },
    });

    expect(provider.constructor.name).toBe("QqMutableProvider");
    expect(JSON.stringify(provider)).not.toContain("secret-auth-code");
  });
});
