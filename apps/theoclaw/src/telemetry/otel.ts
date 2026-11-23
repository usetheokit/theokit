import { createServer, type Server } from 'node:http'

import type { LogRecordExporter } from '@opentelemetry/sdk-logs'
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
  | { readonly enabled: true; readonly endpoint: string; readonly serviceName: string; readonly prometheusPort?: number; readonly anonymous?: boolean }

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
  const port = blankToUndefined(env.THEOCLAW_PROMETHEUS_PORT)
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) {
    throw new TheoClawConfigError('THEOCLAW_PROMETHEUS_PORT must be an integer from 0 to 65535', { variable: 'THEOCLAW_PROMETHEUS_PORT' })
  }
  const anonymous = blankToUndefined(env.THEOCLAW_ANONYMOUS_TELEMETRY)
  if (anonymous !== undefined && anonymous !== 'on' && anonymous !== 'off') {
    throw new TheoClawConfigError('THEOCLAW_ANONYMOUS_TELEMETRY must be on or off', { variable: 'THEOCLAW_ANONYMOUS_TELEMETRY' })
  }
  const profile = blankToUndefined(env.THEOCLAW_PROFILE)
  return {
    enabled: true,
    endpoint: requireHttpEndpoint(endpoint),
    serviceName: profile === undefined ? 'theoclaw' : `theoclaw-${profile}`,
    ...(port === undefined ? {} : { prometheusPort: Number(port) }),
    ...(anonymous === 'on' ? { anonymous: true } : {}),
  }
}

/** The agent option for `settings`, or nothing while telemetry is off. */
export function agentTelemetry(settings: TelemetrySettings): { readonly telemetry?: AgentTelemetry } {
  return settings.enabled ? { telemetry: { enabled: true, serviceName: settings.serviceName, includeContent: false, autoDetect: false } } : {}
}

export interface RegisterTelemetryOptions {
  /** Where one masked line per export failure goes. */
  readonly write: (line: string) => void
  /** Replaces the OTLP/HTTP log exporter. */
  readonly logExporter?: LogRecordExporter
  /** Replaces the OTLP/HTTP span exporter; tests pass an in-memory one. */
  readonly spanExporter?: SpanExporter
  /** Replaces the OTLP/HTTP metric exporter; tests pass an in-memory one. */
  readonly metricExporter?: PushMetricExporter
  readonly anonymousMetricExporter?: PushMetricExporter
}

export interface RegisteredTelemetry {
  /** Records an already masked operational line, never conversation content. */
  log(line: string): void
  /** Resolves after the optional loopback listener is ready; undefined when disabled. */
  readonly prometheusEndpoint: Promise<string | undefined>
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

const NOTHING_REGISTERED: RegisteredTelemetry = { log: () => undefined, prometheusEndpoint: Promise.resolve(undefined), flush: async () => undefined, shutdown: async () => undefined }

/**
 * Register a tracer provider and a meter provider as the globals the SDK records through, with
 * OTLP/HTTP exporters behind a batch processor and a periodic reader, so an export never runs on
 * the turn path (FR-006, NFR-004). Nothing is registered while telemetry is off.
 */
export async function registerTelemetry(settings: TelemetrySettings, options: RegisterTelemetryOptions): Promise<RegisteredTelemetry> {
  if (!settings.enabled) return NOTHING_REGISTERED
  // Agent factories read settings even in the TUI and other telemetry-disabled processes.
  // Keep the optional host exporters off that startup path.
  const [{ OTLPLogExporter }, { BatchLogRecordProcessor, LoggerProvider }, prometheusModule] = await Promise.all([
    import('@opentelemetry/exporter-logs-otlp-http'),
    import('@opentelemetry/sdk-logs'),
    settings.prometheusPort === undefined ? undefined : import('@opentelemetry/exporter-prometheus'),
  ])
  diag.setLogger(failureLogger(options.write), DiagLogLevel.ERROR)
  const spanExporter = options.spanExporter ?? new OTLPTraceExporter({ url: `${settings.endpoint}/v1/traces`, timeoutMillis: EXPORT_TIMEOUT_MS })
  const metricExporter =
    options.metricExporter ?? new OTLPMetricExporter({ url: `${settings.endpoint}/v1/metrics`, timeoutMillis: EXPORT_TIMEOUT_MS })
  // The SDK names the service only as its tracer's scope; the collector reads `service.name` from the resource.
  const resource = resourceFromAttributes({ 'service.name': settings.serviceName })
  const loggerProvider = new LoggerProvider({ resource, processors: [new BatchLogRecordProcessor({
    exporter: options.logExporter ?? new OTLPLogExporter({ url: `${settings.endpoint}/v1/logs`, timeoutMillis: EXPORT_TIMEOUT_MS }),
    exportTimeoutMillis: EXPORT_TIMEOUT_MS,
  })] })
  const logger = loggerProvider.getLogger('theoclaw')
  const prometheus = prometheusModule === undefined ? undefined : new prometheusModule.PrometheusExporter({ preventServerStart: true })
  let scrapeServer: Server | undefined
  const prometheusEndpoint = prometheus === undefined ? Promise.resolve(undefined) : new Promise<string | undefined>((resolve) => {
    const reader = prometheus
    scrapeServer = createServer((request, response) => {
      if (request.url !== '/metrics' || request.method !== 'GET') {
        response.writeHead(404).end()
        return
      }
      reader.getMetricsRequestHandler(request, response)
    })
    scrapeServer.once('error', (error) => {
      diag.error(error.message)
      resolve(undefined)
    })
    scrapeServer.listen(settings.prometheusPort, '127.0.0.1', () => {
      const address = scrapeServer?.address()
      resolve(address != null && typeof address !== 'string' ? `http://127.0.0.1:${address.port}/metrics` : undefined)
    })
  })
  const tracerProvider = new TracerProvider({ resource, spanProcessors: [new BatchSpanProcessor({ exporter: spanExporter })] })
  const meterProvider = new MeterProvider({
    resource,
    readers: [...(prometheus === undefined ? [] : [prometheus]), new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: METRIC_INTERVAL_MS, exportTimeoutMillis: EXPORT_TIMEOUT_MS })],
  })
  trace.setGlobalTracerProvider(tracerProvider)
  metrics.setGlobalMeterProvider(meterProvider)
  // A separate, constant resource avoids profile names, host ids and user identifiers.
  const anonymousProvider = settings.anonymous ? new MeterProvider({
    resource: resourceFromAttributes({ 'service.name': 'theoclaw-anonymous' }),
    readers: [new PeriodicExportingMetricReader({ exporter: options.anonymousMetricExporter ?? new OTLPMetricExporter({ url: `${settings.endpoint}/v1/metrics`, timeoutMillis: EXPORT_TIMEOUT_MS }), exportIntervalMillis: METRIC_INTERVAL_MS })],
  }) : undefined
  anonymousProvider?.getMeter('theoclaw-anonymous').createCounter('theoclaw_anonymous_starts').add(1)
  const flush = async (): Promise<void> => {
    await Promise.allSettled([tracerProvider.forceFlush(), meterProvider.forceFlush(), loggerProvider.forceFlush(), ...(anonymousProvider ? [anonymousProvider.forceFlush()] : [])])
  }
  return {
    log: (line) => logger.emit({ body: redactSecrets(line).replace(/\/\/[^/@\s]+@/g, '//***@'), severityText: 'INFO' }),
    prometheusEndpoint,
    flush,
    shutdown: async () => {
      await prometheusEndpoint
      if (scrapeServer !== undefined) {
        const server = scrapeServer
        await new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
      }
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown(), loggerProvider.shutdown(), ...(anonymousProvider ? [anonymousProvider.shutdown()] : [])])
      trace.disable()
      metrics.disable()
      diag.disable()
    },
  }
}
