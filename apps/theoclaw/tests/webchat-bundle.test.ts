// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { renderPage } from "../src/webchat/page.js";
import { createWebchatRoutes } from "../src/webchat/routes.js";

// Derived from this file, not from WEBCHAT_ASSETS_DIR: under happy-dom vitest rewrites a source
// module's import.meta.url to an http: URL. tests/webchat-access.test.ts pins the directory itself.
const APP_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "web", "assets", "app.js");

/** EC-10 (B-368): the shell holds the element the bundle mounts on. */
describe("the page shell", () => {
  it("holds the id=root element main.tsx mounts on", () => {
    const shell = document.createElement("template");
    shell.innerHTML = renderPage();

    expect(shell.content.querySelector("#root")).not.toBeNull();
  });
});

/**
 * AC-005 (B-368): the BUILT bundle loads in a DOM and renders the page. Skipped without
 * THEOCLAW_BUNDLE=1, since the offline suite runs without `build:web`; with it, a missing bundle fails.
 */
describe.runIf(process.env.THEOCLAW_BUNDLE === "1")("the built bundle", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("sends from the compiled page through the WebChat route and renders the agent stream", async () => {
    expect(existsSync(APP_JS), `run build:web first: ${APP_JS} is missing`).toBe(true);
    sessionStorage.clear();
    const token = "bundle-webchat-token-0123456789abcdef";
    const turns: string[] = [];
    const requests: Request[] = [];
    const handle = createWebchatRoutes({
      token,
      assetsDir: dirname(APP_JS),
      turnFor: () => async (message, emit) => {
        turns.push(message);
        emit({ type: "text_delta", content: "reply from the served agent" });
        return { ok: true };
      },
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return handle(request);
    });
    document.body.innerHTML = '<div id="root"></div>';
    const source = readFileSync(APP_JS, "utf8");

    await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

    await vi.waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull(), { timeout: 5000 });
    const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(password, token);
    password.dispatchEvent(new Event("input", { bubbles: true }));
    password.form!.requestSubmit();

    const composer = await vi.waitFor(() => {
      const field = document.querySelector("textarea");
      expect(field).not.toBeNull();
      return field!;
    });
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, "hello served agent");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    // Let React commit the controlled value before submitting the form.
    await vi.waitFor(() => expect(composer.value).toBe("hello served agent"));
    composer.form!.requestSubmit();

    await vi.waitFor(() => expect(document.querySelector('[data-role="assistant"]')?.textContent).toBe("reply from the served agent"));
    expect(turns).toEqual(["hello served agent"]);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/webchat/chat");
    expect(requests[0]!.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(requests[0]!.url).not.toContain(token);
  });
});
