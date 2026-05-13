import { createHash, randomBytes } from "node:crypto";

export type ProviderId = "fixture" | "qqmail" | "gmail";
export type OperationAction = "move" | "mark_read" | "mark_unread" | "create_folder";
export type OperationPlanStatus = "preview" | "confirmed";
export type OperationPlanSource = "rules_preview" | "client_refs" | "bulk_governance";

export interface MessageRef {
  provider: ProviderId;
  accountAlias: string;
  folder: string;
  uid: string;
  uidValidity?: string;
}

export interface CreateOperationPlanInput {
  runId: string;
  provider: ProviderId;
  action: OperationAction;
  messageRefs: MessageRef[];
  target?: Record<string, string>;
  source?: OperationPlanSource;
}

export interface OperationPlan {
  operationPlanId: string;
  runId: string;
  provider: ProviderId;
  action: OperationAction;
  status: OperationPlanStatus;
  source: OperationPlanSource;
  confirmationRequired: boolean;
  messageRefs: MessageRef[];
  target?: Record<string, string>;
}

export function createOperationPlan(input: CreateOperationPlanInput): OperationPlan {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      runId: input.runId,
      provider: input.provider,
      action: input.action,
      messageRefs: input.messageRefs,
      target: input.target ?? {},
    }))
    .digest("hex")
    .slice(0, 12);

  return {
    operationPlanId: `op_${fingerprint}_${randomBytes(3).toString("hex")}`,
    runId: input.runId,
    provider: input.provider,
    action: input.action,
    status: "preview",
    source: input.source ?? "rules_preview",
    confirmationRequired: true,
    messageRefs: input.messageRefs,
    target: input.target,
  };
}

export function confirmOperationPlan(plan: OperationPlan, requestedOperationPlanId: string): OperationPlan {
  if (plan.operationPlanId !== requestedOperationPlanId) {
    throw new Error(`Operation plan id does not match: expected ${plan.operationPlanId}`);
  }

  return {
    ...plan,
    status: "confirmed",
  };
}
