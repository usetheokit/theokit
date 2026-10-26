// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { renderPage } from "../src/webchat/page.js";

// Derived from this file, not from WEBCHAT_ASSETS_DIR: under happy-dom vitest rewrites a source
// module's import.meta.url to an http: URL. tests/webchat-access.test.ts pins the directory itself.
const APP_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "web", "assets", "app.js");

/** EC-10 (B-368): the shell holds the element the bundle mounts on. */
describe("the page shell", () => {
  it("holds the id=root element main.tsx mounts on", () => {
    const shell = new DOMParser().parseFromString(renderPage(), "text/html");

    expect(shell.getElementById("root")).not.toBeNull();
  });
});

/**
 * AC-005 (B-368): the BUILT bundle loads in a DOM and renders the page. Skipped without
 * THEOCLAW_BUNDLE=1, since the offline suite runs without `build:web`; with it, a missing bundle fails.
 */
describe.runIf(process.env.THEOCLAW_BUNDLE === "1")("the built bundle", () => {
  it("renders the token field when loaded into a document with a root element", async () => {
    expect(existsSync(APP_JS), `run build:web first: ${APP_JS} is missing`).toBe(true);
    document.body.innerHTML = '<div id="root"></div>';
    const source = readFileSync(APP_JS, "utf8");

    await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

    await vi.waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull(), { timeout: 5000 });
  });
});
