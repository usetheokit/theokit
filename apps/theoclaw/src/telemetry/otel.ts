import { diag, DiagLogLevel, metrics, trace } from '@opentelemetry/api'
import type { DiagLogger } from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader, type PushMetricExporter } from '@opentelemetry/sdk-metrics'
import { BatchSpanProcessor, type SpanExporter, TracerProvider } from '@opentelemetry/sdk-trace'
import { redactSecrets } from '@theokit/gateway'

import { TheoClawConfigError } from '../control-plane/errors.js'

type Env = Readonly<Record<string, string | undefined>>

/** Whether telemetry is on, and where it is sent (`THEOCLAW_OTEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`). */
export type TelemetrySettings =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly endpoint: string; readonly serviceName: string }

/** The SDK's `telemetry` option every agent is created with while telemetry is on (plan D3). */
export interface AgentTelemetry {
  readonly enabled: true
  readonly serviceName: string
  /** Prompts, replies and tool arguments stay out of spans. */
  readonly includeContent: false
  /** Off, so the SDK wires no exporter of an observability library it finds installed: the collector named is the only destination. */
  readonly autoDetect: false
}

/** How long one export may take before it is reported failed; off the turn path either way. */
const EXPORT_TIMEOUT_MS = 5_000
const METRIC_INTERVAL_MS = 60_000

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function requireHttpEndpoint(value: string): string {
  let url: URL | undefined
  try {
    url = new URL(value)
  } catch {
    url = undefined
  }
  if (url === undefined || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new TheoClawConfigError('OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL', { variable: 'OTEL_EXPORTER_OTLP_ENDPOINT' })
  }
  return value.replace(/\/+$/, '')
}

/**
 * Telemetry is opt-in (plan D3): an exporter sends turn metadata off the host. `on` without an
 * endpoint, an endpoint that is not an http(s) URL (EC-6) and any value but `on` or `off` stop the
 * start, naming the variable and never the value.
 */
export function readTelemetrySettings(env: Env): TelemetrySettings {
  const mode = blankToUndefined(env.THEOCLAW_OTEL)
  if (mode === undefined || mode === 'off') return { enabled: false }
  if (mode !== 'on') throw new TheoClawConfigError('THEOCLAW_OTEL must be on or off', { variable: 'THEOCLAW_OTEL' })
  const endpoint = blankToUndefined(env.OTEL_EXPORTER_OTLP_ENDPOINT)
  if (endpoint === undefined) {
    throw new TheoClawConfigError('THEOCLAW_OTEL=on needs OTEL_EXPORTER_OTLP_ENDPOINT, the collector to send to', {
      variable: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    })
  }
  const profile = blankToUndefined(env.THEOCLAW_PROFILE)
  return { enabled: true, endpoint: requireHttpEndpoint(endpoint), serviceName: profile === undefined ? 'theoclaw' : `theoclaw-${profile}` }
}

/** The agent option for `settings`, or nothing while telemetry is off. */
export function agentTelemetry(settings: TelemetrySettings): { readonly telemetry?: AgentTelemetry } {
  return settings.enabled ? { telemetry: { enabled: true, serviceName: settings.serviceName, includeContent: false, autoDetect: false } } : {}
}

export interface RegisterTelemetryOptions {
  /** Where one masked line per export failure goes. */
  readonly write: (line: string) => void
  /** Replaces the OTLP/HTTP span exporter; tests pass an in-memory one. */
  readonly spanExporter?: SpanExporter
  /** Replaces the OTLP/HTTP metric exporter; tests pass an in-memory one. */
  readonly metricExporter?: PushMetricExporter
}

export interface RegisteredTelemetry {
  /** Export what is pending now. */
  flush(): Promise<void>
  /** Export what is pending, then unregister the providers. Never rejects. */
  shutdown(): Promise<void>
}

/**
 * The OpenTelemetry `diag` logger: an export that fails reaches it through the SDK's global error
 * handler, and is written as one masked line. The theokit SDK guards only its own tracer calls, so
 * the host owns exporter failures (alignment revision 2).
 */
function failureLogger(write: (line: string) => void): DiagLogger {
  const report = (message: string, ...args: unknown[]): void => {
    const detail = [message, ...args.map((arg) => (arg instanceof Error ? arg.message : String(arg)))].join(' ')
    // A URL's userinfo is a credential an exporter error may quote.
    const masked = redactSecrets(detail).replace(/\/\/[^/@\s]+@/g, '//***@')
    write(`theoclaw: telemetry export failed: ${masked.replace(/\s+/g, ' ').trim()}`)
  }
  const ignore = (): void => undefined
  return { error: report, warn: ignore, info: ignore, debug: ignore, verbose: ignore }
}

const NOTHING_REGISTERED: RegisteredTelemetry = { flush: async () => undefined, shutdown: async () => undefined }

/**
 * Register a tracer provider and a meter provider as the globals the SDK records through, with
 * OTLP/HTTP exporters behind a batch processor and a periodic reader, so an export never runs on
 * the turn path (FR-006, NFR-004). Nothing is registered while telemetry is off.
 */
export function registerTelemetry(settings: TelemetrySettings, options: RegisterTelemetryOptions): RegisteredTelemetry {
  if (!settings.enabled) return NOTHING_REGISTERED
  diag.setLogger(failureLogger(options.write), DiagLogLevel.ERROR)
  const spanExporter = options.spanExporter ?? new OTLPTraceExporter({ url: `${settings.endpoint}/v1/traces`, timeoutMillis: EXPORT_TIMEOUT_MS })
  const metricExporter =
    options.metricExporter ?? new OTLPMetricExporter({ url: `${settings.endpoint}/v1/metrics`, timeoutMillis: EXPORT_TIMEOUT_MS })
  // The SDK names the service only as its tracer's scope; the collector reads `service.name` from the resource.
  const resource = resourceFromAttributes({ 'service.name': settings.serviceName })
  const tracerProvider = new TracerProvider({ resource, spanProcessors: [new BatchSpanProcessor({ exporter: spanExporter })] })
  const meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: METRIC_INTERVAL_MS, exportTimeoutMillis: EXPORT_TIMEOUT_MS })],
  })
  trace.setGlobalTracerProvider(tracerProvider)
  metrics.setGlobalMeterProvider(meterProvider)
  const flush = async (): Promise<void> => {
    await Promise.allSettled([tracerProvider.forceFlush(), meterProvider.forceFlush()])
  }
  return {
    flush,
    shutdown: async () => {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()])
      trace.disable()
      metrics.disable()
      diag.disable()
    },
  }
}
