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
    const resourceUri = resources.resources.find((resource) => resource.uri.includes("sensitive-cleanup"))?.uri;
    if (!resourceUri) throw new Error("Sensitive cleanup widget resource not found");
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
  const callTool = vi.fn(async () => options.callToolResult ?? {});
  const notifyIntrinsicHeight = vi.fn();
  const windowStub: any = {
    openai: {
      toolOutput: options.toolOutput ?? {},
      toolResponseMetadata: options.toolResponseMetadata ?? {},
      widgetState: options.widgetState ?? {},
      setWidgetState,
      callTool,
      notifyIntrinsicHeight,
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

describe("QFerry sensitive cleanup widget harness", () => {
  it("does not apply a completed widgetState from a different operation plan", async () => {
    const mounted = await mountWidget({
      toolOutput: {
        operationPlanId: "op_new_plan",
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
    expect(mounted.status.textContent).toBe("Sensitive cleanup plan loaded from chat.");
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

    expect(mounted.callTool).toHaveBeenCalledWith("execute_sensitive_cleanup_from_ui", {
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

  it("uses iframe-safe layout rules instead of compensating with oversized offsets", async () => {
    const style = extractStyle(await readWidgetHtml());

    expect(style).not.toMatch(/position\s*:\s*absolute/i);
    expect(style).not.toMatch(/width\s*:\s*100vw/i);
    expect(style).not.toMatch(/margin-left\s*:\s*-/i);
    expect(style).not.toMatch(/left\s*:\s*-/i);
    expect(style).not.toMatch(/translateX\s*\(/i);
    expect(style).not.toMatch(/padding\s*:\s*[^;]*\b(?:[6-9]\d|1\d{2,})px/i);
  });
});
