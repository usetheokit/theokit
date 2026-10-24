import { request } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { resolveBindAddress } from "../src/control-plane/bind.js";
import { TheoClawBindError } from "../src/control-plane/errors.js";
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from "../src/control-plane/listener.js";

const lines: string[] = [];
const stderr = (line: string): void => void lines.push(line);
let handle: ControlPlaneHandle | undefined;

afterEach(async () => {
  if (handle !== undefined) {
    await handle.close();
    expect(handle.server.listening).toBe(false);
    handle = undefined;
  }
  lines.length = 0;
});

function base(): string {
  const { host, port } = handle!.address();
  return `http://${host}:${port}`;
}

/** A raw upgrade request; resolves with the status the server answered. */
function upgrade(path: string): Promise<number | undefined> {
  const { host, port } = handle!.address();
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, headers: { Connection: "Upgrade", Upgrade: "websocket" } });
    req.on("response", (response) => resolve(response.statusCode));
    req.on("upgrade", () => reject(new Error("the upgrade was accepted")));
    req.on("error", reject);
    req.end();
  });
}

/** AC-002 (B-372): the listener reports the address the socket holds and answers /health. */
describe("listenControlPlane", () => {
  it("reports 127.0.0.1 from the socket when bound with no host configured", async () => {
    handle = await listenControlPlane({ handler: healthHandler, port: 0, host: resolveBindAddress({}), stderr });

    expect(handle.address().host).toBe("127.0.0.1");
    expect(handle.address().port).toBeGreaterThan(0);
  });

  it("answers GET /health with 200 and every other path with 404", async () => {
    handle = await listenControlPlane({ handler: healthHandler, port: 0, host: "127.0.0.1", stderr });

    const health = await fetch(`${base()}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect((await fetch(`${base()}/`)).status).toBe(404);
    expect((await fetch(`${base()}/health`, { method: "POST" })).status).toBe(404);
  });

  it("a bind to an address the host does not have ends with TheoClawBindError naming the address", async () => {
    // 192.0.2.0/24 is TEST-NET-1 (RFC 5737): reserved for documentation, assigned to no host.
    const attempt = listenControlPlane({ handler: healthHandler, port: 0, host: "192.0.2.1", stderr });

    await expect(attempt).rejects.toThrow(TheoClawBindError);
    await expect(attempt).rejects.toThrow(/192\.0\.2\.1/);
    await expect(attempt).rejects.toMatchObject({ address: "192.0.2.1" });
  });

  it("a bind to a port already in use ends with TheoClawBindError naming the port", async () => {
    handle = await listenControlPlane({ handler: healthHandler, port: 0, host: "127.0.0.1", stderr });
    const { port } = handle.address();

    const attempt = listenControlPlane({ handler: healthHandler, port, host: "127.0.0.1", stderr });

    await expect(attempt).rejects.toThrow(TheoClawBindError);
    await expect(attempt).rejects.toThrow(new RegExp(`port ${port}`));
    await expect(attempt).rejects.toMatchObject({ port, address: "127.0.0.1" });
  });

  it("closes once when close is called twice", async () => {
    handle = await listenControlPlane({ handler: healthHandler, port: 0, host: "127.0.0.1", stderr });

    await Promise.all([handle.close(), handle.close()]);
    expect(handle.server.listening).toBe(false);
  });

  it("answers 500 and writes the reason when the handler throws", async () => {
    const handler = async (): Promise<Response> => {
      throw new Error("handler broke");
    };
    handle = await listenControlPlane({ handler, port: 0, host: "127.0.0.1", stderr });

    expect((await fetch(`${base()}/anything`)).status).toBe(500);
    expect(lines.join("\n")).toContain("handler broke");
  });

  it("answers 500 when the request cannot be converted", async () => {
    handle = await listenControlPlane({ handler: healthHandler, port: 0, host: "127.0.0.1", stderr });
    const { host, port } = handle.address();

    // `new Request` refuses a URL whose host carries a space, so the conversion itself throws.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ host, port, path: "/health", headers: { Host: "bad host" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(500);
    expect(lines.join("\n")).toContain("request failed");
  });

  it("answers 404 to every upgrade when no control socket is configured", async () => {
    handle = await listenControlPlane({ handler: healthHandler, port: 0, host: "127.0.0.1", stderr });

    expect(await upgrade("/control")).toBe(404);
  });
});
