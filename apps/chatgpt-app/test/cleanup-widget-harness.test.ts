import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createQFerryMcpServer } from "../src/mcp-server.js";

type Listener = (event?: any) => unknown;

class FakeElement {
  className = "";
  disabled = false;
  textContent = "";
  children: FakeElement[] = [];
  private listeners = new Map<string, Listener[]>();

  constructor(readonly id = "", readonly tagName = "div") {}

  set innerHTML(_value: string) {
    this.children = [];
  }

  get innerHTML(): string {
    return this.children.map((child) => child.textContent).join("");
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async click() {
    const listeners = this.listeners.get("click") ?? [];
    await Promise.all(listeners.map((listener) => listener()));
  }
}

class FakeDocument {
  readonly elements = new Map<string, FakeElement>();
  private listeners = new Map<string, Listener[]>();

  constructor(ids: string[]) {
    for (const id of ids) this.elements.set(id, new FakeElement(id));
  }

  getElementById(id: string): FakeElement {
    const element = this.elements.get(id);
    if (!element) throw new Error(`Missing fake element: ${id}`);
    return element;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement("", tagName);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
}

async function readWidgetHtml(): Promise<string> {
  const server = createQFerryMcpServer();
  const client = new Client({ name: "qferry-widget-harness", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const resources = await client.listResources();
    const resourceUri = resources.resources.find((resource) => resource.uri.includes("cleanup-execution"))?.uri;
    if (!resourceUri) throw new Error("Cleanup execution widget resource not found");
    const resource = await client.readResource({ uri: resourceUri });
    return (resource.contents[0] as { text?: string }).text ?? "";
  } finally {
    await client.close();
    await server.close();
  }
}

function extractScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Widget script not found");
  return match[1];
}

function extractStyle(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match?.[1]) throw new Error("Widget style not found");
  return match[1];
}

async function mountWidget(options: {
  toolOutput?: Record<string, unknown>;
  toolResponseMetadata?: Record<string, unknown>;
  widgetState?: Record<string, unknown>;
  callToolResult?: Record<string, unknown>;
}) {
  const html = await readWidgetHtml();
  const document = new FakeDocument(["total", "categories", "execute", "refresh", "status", "meta"]);
  const messageListeners: Listener[] = [];
  const setWidgetState = vi.fn(async (nextState: Record<string, unknown>) => {
    windowStub.openai.widgetState = nextState;
  });
  const callTool = vi.fn(async (name: string) => {
    if (name === "record_widget_diagnostic") return { structuredContent: { ok: true } };
    return options.callToolResult ?? {};
  });
  const notifyIntrinsicHeight = vi.fn();
  const windowStub: any = {
    openai: {
      toolOutput: options.toolOutput ?? {},
      toolResponseMetadata: options.toolResponseMetadata ?? {},
      widgetState: options.widgetState ?? {},
      setWidgetState,
      callTool,
      notifyIntrinsicHeight,
      widgetSessionId: "widget-session-test",
    },
    addEventListener(type: string, listener: Listener) {
      if (type === "message") messageListeners.push(listener);
    },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  };
  const context = {
    window: windowStub,
    document,
    console,
    Error,
    Number,
    Object,
    String,
    Boolean,
  };
  const { Script, createContext } = await import("node:vm");
  new Script(extractScript(html)).runInContext(createContext(context));
  await Promise.resolve();
  await Promise.resolve();
  return {
    html,
    document,
    window: windowStub,
    total: document.getElementById("total"),
    categories: document.getElementById("categories"),
    execute: document.getElementById("execute"),
    status: document.getElementById("status"),
    meta: document.getElementById("meta"),
    setWidgetState,
    callTool,
  };
}

describe("QFerry cleanup execution widget harness", () => {
  it("lets normal cleanup plans execute from the UI without sensitive metadata", async () => {
    const mounted = await mountWidget({
      toolOutput: {
        operationPlanId: "op_normal_plan",
        runId: "run-normal-infra",
        sensitivity: "normal",
        categories: { infra: 95 },
        totalPlanMessages: 95,
      },
      toolResponseMetadata: {},
      widgetState: {},
      callToolResult: {
        structuredContent: {
          moved: 95,
          result: { remainingMessages: 0, status: "executed" },
        },
      },
    });

    expect(mounted.total.textContent).toBe("95 planned");
    expect(mounted.execute.textContent).toBe("Move planned mail");
    expect(mounted.execute.disabled).toBe(false);
    expect(mounted.status.textContent).toBe("Cleanup plan ready for user confirmation.");
    expect(mounted.callTool).toHaveBeenCalledWith("record_widget_diagnostic", expect.objectContaining({
      event: "widget_loaded",
      widgetVersion: "qferry-ui v2026-06-28-1930",
      resourceUri: "ui://qferry/cleanup-execution.v11.html",
      widgetSessionId: "widget-session-test",
    }));
    expect(mounted.callTool).toHaveBeenCalledWith("record_widget_diagnostic", expect.objectContaining({
      event: "widget_hydrated",
      operationPlanId: "op_normal_plan",
      runId: "run-normal-infra",
      sensitivity: "normal",
      totalPlanMessages: 95,
      callToolAvailable: true,
    }));

    await mounted.execute.click();

    expect(mounted.callTool).toHaveBeenCalledWith("execute_cleanup_from_ui", {
      operationPlanId: "op_normal_plan",
      maxMessages: 95,
    });
    expect(mounted.callTool).toHaveBeenCalledWith("record_widget_diagnostic", expect.objectContaining({
      event: "execute_clicked",
      operationPlanId: "op_normal_plan",
    }));
    expect(mounted.callTool).toHaveBeenCalledWith("record_widget_diagnostic", expect.objectContaining({
      event: "execute_result",
      operationPlanId: "op_normal_plan",
      totalPlanMessages: 0,
      message: "ok",
    }));
    expect(mounted.total.textContent).toBe("Done");
    expect(mounted.status.textContent).toBe("Moved 95 messages.");
  });

  it("does not apply a completed widgetState from a different operation plan", async () => {
    const mounted = await mountWidget({
      toolOutput: {
        operationPlanId: "op_new_plan",
        sensitivity: "sensitive",
        categories: { account_security: 1 },
        totalPlanMessages: 1,
      },
      toolResponseMetadata: { confirmToken: "confirm-new" },
      widgetState: {
        operationPlanId: "op_old_plan",
        categories: { account_security: 0 },
        totalPlanMessages: 0,
        completed: true,
        lastResult: { moved: 1 },
      },
    });

    expect(mounted.total.textContent).toBe("1 planned");
    expect(mounted.execute.textContent).toBe("Move planned mail");
    expect(mounted.execute.disabled).toBe(false);
    expect(mounted.status.textContent).toBe("Sensitive plan loaded from chat.");
    expect(mounted.meta.textContent).toContain("ready");
    expect(mounted.setWidgetState).toHaveBeenCalledWith(expect.objectContaining({
      operationPlanId: "op_new_plan",
      completed: false,
      totalPlanMessages: 1,
    }));
  });

  it("renders completed state for the current operation plan", async () => {
    const mounted = await mountWidget({
      toolOutput: {
        operationPlanId: "op_current_plan",
        categories: { account_security: 1 },
        totalPlanMessages: 1,
      },
      toolResponseMetadata: { confirmToken: "confirm-current" },
      widgetState: {
        operationPlanId: "op_current_plan",
        categories: { account_security: 0 },
        totalPlanMessages: 0,
        completed: true,
        lastResult: { moved: 1, result: { remainingMessages: 0 } },
      },
    });

    expect(mounted.total.textContent).toBe("Done");
    expect(mounted.execute.textContent).toBe("Moved");
    expect(mounted.execute.disabled).toBe(true);
    expect(mounted.status.textContent).toBe("Moved 1 messages.");
    expect(mounted.meta.textContent).toContain("completed");
  });

  it("updates the DOM and widgetState after app-only execution", async () => {
    const mounted = await mountWidget({
      toolOutput: {
        operationPlanId: "op_click_plan",
        categories: { account_security: 1 },
        totalPlanMessages: 1,
      },
      toolResponseMetadata: { confirmToken: "confirm-click" },
      widgetState: {},
      callToolResult: {
        structuredContent: {
          moved: 1,
          result: { remainingMessages: 0, status: "executed" },
        },
      },
    });

    await mounted.execute.click();

    expect(mounted.callTool).toHaveBeenCalledWith("execute_cleanup_from_ui", {
      operationPlanId: "op_click_plan",
      confirmToken: "confirm-click",
      maxMessages: 1,
    });
    expect(mounted.total.textContent).toBe("Done");
    expect(mounted.execute.textContent).toBe("Moved");
    expect(mounted.execute.disabled).toBe(true);
    expect(mounted.status.textContent).toBe("Moved 1 messages.");
    expect(mounted.setWidgetState).toHaveBeenLastCalledWith(expect.objectContaining({
      operationPlanId: "op_click_plan",
      totalPlanMessages: 0,
      completed: true,
    }));
  });

  it("reports bridge execution errors without blocking the UI error state", async () => {
    const mounted = await mountWidget({
      toolOutput: {
        operationPlanId: "op_error_plan",
        sensitivity: "normal",
        categories: { infra: 2 },
        totalPlanMessages: 2,
      },
      widgetState: {},
    });
    mounted.callTool.mockImplementation(async (name: string) => {
      if (name === "record_widget_diagnostic") return { structuredContent: { ok: true } };
      throw new Error("bridge unavailable");
    });

    await mounted.execute.click();

    expect(mounted.status.textContent).toBe("bridge unavailable");
    expect(mounted.execute.disabled).toBe(false);
    expect(mounted.callTool).toHaveBeenCalledWith("record_widget_diagnostic", expect.objectContaining({
      event: "widget_error",
      operationPlanId: "op_error_plan",
      message: "bridge unavailable",
    }));
  });

  it("uses a host-safe inner content area instead of placing content on the iframe edge", async () => {
    const style = extractStyle(await readWidgetHtml());

    expect(style).not.toMatch(/position\s*:\s*absolute/i);
    expect(style).not.toMatch(/width\s*:\s*100vw/i);
    expect(style).not.toMatch(/margin-left\s*:\s*-/i);
    expect(style).not.toMatch(/left\s*:\s*-/i);
    expect(style).not.toMatch(/translateX\s*\(/i);
    expect(style).toMatch(/body\s*\{[\s\S]*?padding:\s*0;/i);
    expect(style).toMatch(/\.panel\s*\{[\s\S]*?padding:\s*24px\s+72px\s+28px;/i);
    expect(style).toMatch(/\.head\s*\{[\s\S]*?justify-content:\s*space-between;/i);
  });
});
