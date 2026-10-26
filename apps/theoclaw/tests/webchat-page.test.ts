// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChatAppModule = typeof import("../web/chat-app.js");

const TOKEN = "w".repeat(40);

/** The UIMessage wire a WebChat turn answers with: one text block, then the terminal frames. */
const REPLY_FRAMES = [
  { type: "start" },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "hello " },
  { type: "text-delta", id: "t", delta: "from the agent" },
  { type: "text-end", id: "t" },
  { type: "finish" },
];

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function replyStream(): ReadableStream<Uint8Array> {
  const text = [...REPLY_FRAMES.map((frame) => `data: ${JSON.stringify(frame)}\n\n`), "data: [DONE]\n\n"].join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

let recorded: Recorded[] = [];
let page: ChatAppModule;
let root: Root | undefined;
let container: HTMLElement;

beforeEach(async () => {
  // A fresh module per test: the token store keeps an in-memory copy beside sessionStorage.
  vi.resetModules();
  page = await import("../web/chat-app.js");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  recorded = [];
  sessionStorage.clear();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    recorded.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: JSON.parse(await request.text()) as unknown,
    });
    return new Response(replyStream(), { headers: { "content-type": "text/event-stream" } });
  });
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Mount the page, give it the token and send one message, as the owner does. */
async function sendThroughThePage(message: string): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(page.ChatApp));
  });
  const tokenField = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => setInputValue(tokenField, TOKEN));
  await act(async () => tokenField.form!.requestSubmit());
  const textarea = await vi.waitFor(() => {
    const found = container.querySelector("textarea");
    if (found === null) throw new Error("the composer is not on the page yet");
    return found;
  });
  await act(async () => setInputValue(textarea, message));
  await act(async () => textarea.form!.requestSubmit());
}

/** AC-006 (B-368): the page sends the token only in the header, and shows the streamed reply. */
describe("the WebChat page", () => {
  it("posts once to /webchat/chat with the Bearer token and a body whose message field is the text", async () => {
    await sendThroughThePage("hello agent");

    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    const [request] = recorded;
    expect(new URL(request!.url).pathname).toBe("/webchat/chat");
    expect(request!.method).toBe("POST");
    expect(request!.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(request!.body).toMatchObject({ message: "hello agent" });
  });

  it("shows the streamed reply text in the thread", async () => {
    await sendThroughThePage("hello agent");

    await vi.waitFor(() => expect(container.textContent).toContain("hello from the agent"));
  });

  it("keeps the token in sessionStorage and out of the page URL and the request URL", async () => {
    await sendThroughThePage("hello agent");

    await vi.waitFor(() => expect(recorded).toHaveLength(1));
    expect(Object.values({ ...sessionStorage })).toContain(TOKEN);
    expect(location.href).not.toContain(TOKEN);
    expect(recorded[0]!.url).not.toContain(TOKEN);
  });
});
