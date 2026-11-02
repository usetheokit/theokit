/**
 * B-400 T2.1 (FR-006, FR-007, NFR-004): `THEOCLAW_OTEL=on` registers a tracer and a meter provider
 * and creates every agent with SDK telemetry on; a collector that is down costs no turn.
 */
import { InMemoryMetricExporter, AggregationTemporality } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it } from "vitest";

import { createTheoClawAgent } from "../src/agent/create-agent.js";
import { agentOptionsFor, createAgentFactory, sessionAgentOptions, type CreateAgent } from "../src/control-plane/agent-factory.js";
import { TheoClawConfigError } from "../src/control-plane/errors.js";
import type { TurnAgent } from "../src/control-plane/turn.js";
import { readTelemetrySettings, registerTelemetry, type RegisteredTelemetry } from "../src/telemetry/otel.js";
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
  });

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
