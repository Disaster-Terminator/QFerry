import { FixtureMailProvider } from "./providers/fixture-provider.js";
import { QqMutableProvider } from "./providers/qq-mutable-provider.js";
import type {
  MailProvider,
  MailboxInfo,
  MessageDetail,
  MessageSummary,
  ProviderCapabilitySnapshot,
  ScanMailboxMetadataInput,
} from "./providers/types.js";
import {
  loadQFerryRuntimeSecretsSync,
  type QFerryRuntimeConfig,
} from "./runtime-config.js";

export interface CreateMailProviderFromRuntimeConfigOptions {
  env?: Record<string, string | undefined>;
}

export function createMailProviderFromRuntimeConfig(
  runtimeConfig: QFerryRuntimeConfig,
  options: CreateMailProviderFromRuntimeConfigOptions = {},
): MailProvider {
  if (runtimeConfig.provider !== "qqmail") {
    return FixtureMailProvider.demo();
  }

  const user = runtimeConfig.qqmail?.email;
  const pass = loadQFerryRuntimeSecretsSync(options.env).qqmailKey;
  if (!user || !pass) {
    return new UnavailableMailProvider(runtimeConfig);
  }

  return new QqMutableProvider({
    accountAlias: runtimeConfig.accountAlias,
    host: runtimeConfig.qqmail?.imapHost || "imap.qq.com",
    port: runtimeConfig.qqmail?.imapPort || 993,
    maxRecommendedScanLimit: runtimeConfig.metadataSampleLimit,
    auth: { user, pass },
  });
}

class UnavailableMailProvider implements MailProvider {
  constructor(private readonly runtimeConfig: QFerryRuntimeConfig) {}

  async listMailboxes(): Promise<MailboxInfo[]> {
    throw this.error();
  }

  async scanMailboxMetadata(_input: ScanMailboxMetadataInput): Promise<MessageSummary[]> {
    throw this.error();
  }

  async fetchMessage(_ref: MessageSummary["ref"]): Promise<MessageDetail> {
    throw this.error();
  }

  async getCapabilitySnapshot(): Promise<ProviderCapabilitySnapshot> {
    return {
      provider: this.runtimeConfig.provider,
      accountAlias: this.runtimeConfig.accountAlias,
      supportsListMailboxes: false,
      supportsMetadataScan: false,
      supportsFetchMessage: false,
      supportsMutation: false,
      mutationActions: [],
      maxRecommendedScanLimit: this.runtimeConfig.metadataSampleLimit,
    };
  }

  private error(): Error {
    const warning = this.runtimeConfig.statusWarnings.join("; ") || "runtime config is incomplete";
    return new Error(`QFerry provider is not ready: ${warning}`);
  }
}
