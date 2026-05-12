import { describe, expect, it } from "vitest";

import {
  confirmOperationPlan,
  createOperationPlan,
  type MessageRef,
} from "../src/operation-plan.js";

const messageRef: MessageRef = {
  provider: "fixture",
  accountAlias: "demo",
  folder: "INBOX",
  uid: "1",
};

describe("operation plans", () => {
  it("creates preview plans without message bodies", () => {
    const plan = createOperationPlan({
      runId: "run-1",
      provider: "fixture",
      action: "move",
      messageRefs: [messageRef],
      target: { folder: "Archive" },
    });

    expect(plan.status).toBe("preview");
    expect(plan.confirmationRequired).toBe(true);
    expect(plan.messageRefs).toEqual([messageRef]);
    expect(JSON.stringify(plan)).not.toContain("body");
  });

  it("confirms a matching operation plan id", () => {
    const plan = createOperationPlan({
      runId: "run-1",
      provider: "fixture",
      action: "mark_read",
      messageRefs: [messageRef],
    });

    const confirmed = confirmOperationPlan(plan, plan.operationPlanId);

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.operationPlanId).toBe(plan.operationPlanId);
  });

  it("rejects confirmation with a mismatched operation plan id", () => {
    const plan = createOperationPlan({
      runId: "run-1",
      provider: "fixture",
      action: "move",
      messageRefs: [messageRef],
    });

    expect(() => confirmOperationPlan(plan, "different-plan")).toThrow(/does not match/);
  });
});
