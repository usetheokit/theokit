import { createServer } from "node:http";
/**
 * B-400 T2.1 (FR-006, FR-007, NFR-004): `THEOCLAW_OTEL=on` registers a tracer and a meter provider
 * and creates every agent with SDK telemetry on; a collector that is down costs no turn.
 */
import { InMemoryMetricExporter, AggregationTemporality } from "@opentelemetry/sdk-metrics";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it } from "vitest";

import { createTheoClawAgent } from "../src/agent/create-agent.js";
import { agentOptionsFor, createAgentFactory, sessionAgentOptions, type CreateAgent } from "../src/control-plane/agent-factory.js";
import { TheoClawConfigError } from "../src/control-plane/errors.js";
import type { TurnAgent } from "../src/control-plane/turn.js";
import { readTelemetrySettings, registerTelemetry, type RegisteredTelemetry } from "../src/telemetry/otel.js";
import { startForTools, stop, tempCwd, notEnforced } from "./tool-start-fixtures.js";
import { startModelStub, type ModelStub } from "./session-model-stub.js";

const ON = { THEOCLAW_MODEL: "m", THEOKIT_API_KEY: "stub-key", THEOCLAW_OTEL: "on", OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" };
const TELEMETRY = { enabled: true, serviceName: "theoclaw", includeContent: false, autoDetect: false };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function recording(): { create: CreateAgent; options: Array<Parameters<CreateAgent>[0]> } {
  const options: Array<Parameters<CreateAgent>[0]> = [];
  return { options, create: async (passed) => (options.push(passed), { send: () => Promise.reject(new Error("unused")) }) };
}

async function stub(): Promise<ModelStub> {
  const model = await startModelStub({ reply: () => "pong" });
  cleanups.push(() => model.close());
  return model;
}

function keep(registered: RegisteredTelemetry): RegisteredTelemetry {
  cleanups.push(() => registered.shutdown());
  return registered;
}

/** One real SDK turn against the stub model; how long it took. */
async function timedTurn(model: ModelStub, env: Record<string, string>): Promise<{ status: string; ms: number }> {
  const agent = (await createTheoClawAgent({ ...agentOptionsFor(env), model: { id: "lmstudio/stub", url: `${model.url}/v1` } } as never)) as unknown as TurnAgent & { [Symbol.asyncDispose](): Promise<void> };
  const started = Date.now();
  const run = await agent.send("ping");
  for await (const _ of run.stream()) void _;
  const { status } = await run.wait();
  const ms = Date.now() - started;
  await agent[Symbol.asyncDispose]();
  return { status, ms };
}

describe("telemetry settings (FR-006, FR-007)", () => {
  it("THEOCLAW_OTEL=on creates agents with telemetry enabled", async () => {
    const { create, options } = recording();
    await createAgentFactory(ON, create)();
    expect(options[0]?.telemetry).toEqual(TELEMETRY);
    expect(agentOptionsFor(ON).telemetry).toEqual(TELEMETRY);
  });

  it("THEOCLAW_OTEL unset creates agents without telemetry", async () => {
    const { create, options } = recording();
    await createAgentFactory({ THEOCLAW_MODEL: "m", THEOKIT_API_KEY: "k" }, create)();
    expect(options[0]).not.toHaveProperty("telemetry");
    expect(readTelemetrySettings({})).toEqual({ enabled: false });
  });

  it("a session agent carries the telemetry settings", () => {
    expect(sessionAgentOptions(ON, "/tmp/ws").telemetry).toEqual(TELEMETRY);
  });

  it("names the profile's instance as the service", () => {
    expect(agentOptionsFor({ ...ON, THEOCLAW_PROFILE: "work" }).telemetry).toEqual({ ...TELEMETRY, serviceName: "theoclaw-work" });
  });

  it("THEOCLAW_OTEL=on without an endpoint refuses the start naming both variables", () => {
    const refusal = () => readTelemetrySettings({ THEOCLAW_OTEL: "on" });
    expect(refusal).toThrow(TheoClawConfigError);
    expect(refusal).toThrow(/THEOCLAW_OTEL.*OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it("THEOCLAW_OTEL=on with an endpoint that is not an http(s) URL refuses the start naming the variable", () => {
    for (const endpoint of ["ftp://collector:4318", "collector:4318", "not a url"]) {
      const refusal = () => readTelemetrySettings({ THEOCLAW_OTEL: "on", OTEL_EXPORTER_OTLP_ENDPOINT: endpoint });
      expect(refusal).toThrow(TheoClawConfigError);
      expect(refusal).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT must be an http\(s\) URL/);
    }
  });

  it("a THEOCLAW_OTEL other than on or off is refused naming it", () => {
    expect(() => readTelemetrySettings({ THEOCLAW_OTEL: "yes" })).toThrow(/THEOCLAW_OTEL must be on or off/);
    expect(readTelemetrySettings({ THEOCLAW_OTEL: "off" })).toEqual({ enabled: false });
  });
});

describe("registered telemetry (FR-006, NFR-004)", () => {
  it("THEOCLAW_OTEL=on exports the SDK's agent.send span and its call duration histogram", async () => {
    const model = await stub();
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const registered = keep(registerTelemetry(readTelemetrySettings(ON), { write: () => undefined, spanExporter: spans, metricExporter: metrics }));

    const turn = await timedTurn(model, ON);
    await registered.flush();

    expect(turn.status).toBe("finished");
    expect(spans.getFinishedSpans().map((span) => span.name)).toContain("agent.send");
    expect(spans.getFinishedSpans()[0]?.resource.attributes["service.name"]).toBe("theoclaw");
    const names = metrics.getMetrics().flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics.map((metric) => metric.descriptor.name)));
    expect(names).toContain("theokit_llm_call_duration_ms");
  });

  // The turn keeps its 1000 ms regression budget below; the test also awaits exporter shutdown,
  // whose own timeout is 5000 ms, so the harness deadline must allow that cleanup to finish.
  it("an unreachable endpoint does not fail the turn", async () => {
    const model = await stub();
    const lines: string[] = [];
    const baseline = await timedTurn(model, { THEOCLAW_MODEL: "m", THEOKIT_API_KEY: "stub-key" });
    const down = { ...ON, OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9" };
    const registered = registerTelemetry(readTelemetrySettings(down), { write: (line) => void lines.push(line) });

    const turn = await timedTurn(model, down);
    await registered.shutdown();

    expect(turn.status).toBe("finished");
    // NFR-004: the exporter runs off the turn path; a down collector adds at most 1000 ms.
    expect(turn.ms - baseline.ms).toBeLessThanOrEqual(1000);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(line).toMatch(/^theoclaw: telemetry export failed: /);
      expect(line.split("\n")).toHaveLength(1);
    }
  }, 15_000);

  it("an export failure line carries no credential of the endpoint's URL", async () => {
    const lines: string[] = [];
    const settings = readTelemetrySettings({ THEOCLAW_OTEL: "on", OTEL_EXPORTER_OTLP_ENDPOINT: "http://user:hunter2-token@127.0.0.1:9" }); // trufflehog:ignore — a made-up credential the mask must remove
    const registered = registerTelemetry(settings, { write: (line) => void lines.push(line) });
    const { diag } = await import("@opentelemetry/api");
    diag.error("export to http://user:hunter2-token@127.0.0.1:9/v1/traces failed"); // trufflehog:ignore — a made-up credential the mask must remove
    await registered.shutdown();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) expect(line).not.toContain("hunter2-token");
  });
});


describe("B-712 log and scrape exports", () => {
  it("exports masked run log lines and exposes SDK turn metrics to a loopback scrape", async () => {
    const model = await stub();
    const logs = new InMemoryLogRecordExporter();
    const registered = keep(registerTelemetry(readTelemetrySettings({ ...ON, THEOCLAW_PROMETHEUS_PORT: "0" }), {
      write: () => undefined, logExporter: logs,
      spanExporter: new InMemorySpanExporter(),
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    }));
    const dirs: Array<() => void> = [];
    const cwd = tempCwd(dirs);
    cleanups.push(async () => { for (const cleanup of dirs) cleanup(); });
    const app = await startForTools({ THEOCLAW_PORT: "0", THEOCLAW_WORKSPACE: cwd, THEOKIT_API_KEY: "private-runtime-key" }, cwd, { detect: notEnforced }, { importedLine: "theoclaw: imported private-runtime-key", telemetryLog: line => registered.log(line) });
    cleanups.push(() => stop(app));
    expect(app.error).toBeUndefined();
    expect((await timedTurn(model, ON)).status).toBe("finished");
    await registered.flush();
    expect(logs.getFinishedLogRecords().map(record => record.body).join("\n")).toContain("theoclaw: control plane listening");
    expect(logs.getFinishedLogRecords().map(record => record.body).join("\n")).not.toContain("private-runtime-key");
    registered.log("export to http://user:private@localhost failed");
    await registered.flush();
    expect(String(logs.getFinishedLogRecords().at(-1)?.body)).not.toContain("private");
    const endpoint = await registered.prometheusEndpoint;
    const response = await fetch(endpoint!);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("theokit_llm_call_duration_ms");

  });

  it("delivers OTLP log bodies to a local collector and closes the scrape listener", async () => {
    const bodies: string[] = [];
    const collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => {
        expect(request.url).toBe("/v1/logs");
        bodies.push(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>(resolve => collector.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>(resolve => collector.close(() => resolve())));
    const address = collector.address();
    if (address === null || typeof address === "string") throw new Error("No collector address");
    const registered = registerTelemetry(readTelemetrySettings({ ...ON, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`, THEOCLAW_PROMETHEUS_PORT: "0" }), {
      write: () => undefined, spanExporter: new InMemorySpanExporter(),
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });
    try {
      registered.log("theoclaw: offline run finished");
      await registered.flush();
      expect(bodies.join("")).toContain("theoclaw: offline run finished");
      expect(bodies.join("")).toContain("theoclaw");
      const endpoint = (await registered.prometheusEndpoint)!;
      expect((await fetch(endpoint)).status).toBe(200);
      expect((await fetch(endpoint.replace("/metrics", "/other"))).status).toBe(404);
    } finally {
      await registered.shutdown();
    }
    await expect(fetch((await registered.prometheusEndpoint)!)).rejects.toThrow();
  });

  it("keeps anonymous telemetry off by default and sends only an aggregate when opted in", async () => {
    for (const enabled of [false, true]) {
      const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
      const registered = registerTelemetry(readTelemetrySettings({ ...ON, THEOCLAW_ANONYMOUS_TELEMETRY: enabled ? "on" : "off" }), {
        write: () => undefined, logExporter: new InMemoryLogRecordExporter(),
        spanExporter: new InMemorySpanExporter(), metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE), anonymousMetricExporter: exporter,
      });
      await registered.flush();
      const anonymous = exporter.getMetrics().flatMap(r => r.scopeMetrics.flatMap(s => s.metrics)).filter(m => m.descriptor.name === "theoclaw_anonymous_starts");
      expect(anonymous).toHaveLength(enabled ? 1 : 0);
      if (enabled) {
        expect(anonymous[0]?.dataPoints[0]?.attributes).toEqual({});
        expect(exporter.getMetrics()[0]?.resource.attributes).toEqual({ "service.name": "theoclaw-anonymous" });
      }
      await registered.shutdown();
    }
  });

  it("does not register any export or listener by default", async () => {
    const registered = registerTelemetry(readTelemetrySettings({}), { write: () => undefined });
    registered.log("private");
    expect(await registered.prometheusEndpoint).toBeUndefined();
    await registered.shutdown();
  });

  it("validates scrape and anonymous options before starting", () => {
    for (const port of ["-1", "65536", "no", "1.5"]) {
      expect(() => readTelemetrySettings({ ...ON, THEOCLAW_PROMETHEUS_PORT: port })).toThrow(/THEOCLAW_PROMETHEUS_PORT/);
    }
    expect(() => readTelemetrySettings({ ...ON, THEOCLAW_ANONYMOUS_TELEMETRY: "yes" })).toThrow(/THEOCLAW_ANONYMOUS_TELEMETRY/);
  });
});
