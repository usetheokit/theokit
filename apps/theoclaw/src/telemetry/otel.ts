import type { LogRecordExporter } from '@opentelemetry/sdk-logs'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics'
import type { SpanExporter } from '@opentelemetry/sdk-trace'
import { redactSecrets } from '@theokit/gateway'
import { registerTelemetry as registerSdkTelemetry } from '@theokit/sdk/telemetry-node'

import { TheoClawConfigError } from '../control-plane/errors.js'

type Env = Readonly<Record<string, string | undefined>>

/** Whether telemetry is on, and where it is sent (`THEOCLAW_OTEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`). */
export type TelemetrySettings =
  | { readonly enabled: false }
  | {
      readonly enabled: true
      readonly endpoint: string
      readonly serviceName: string
      readonly prometheusPort?: number
      readonly anonymous?: boolean
    }

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
    throw new TheoClawConfigError('OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL', {
      variable: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    })
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
  if (mode !== 'on')
    throw new TheoClawConfigError('THEOCLAW_OTEL must be on or off', { variable: 'THEOCLAW_OTEL' })
  const endpoint = blankToUndefined(env.OTEL_EXPORTER_OTLP_ENDPOINT)
  if (endpoint === undefined) {
    throw new TheoClawConfigError(
      'THEOCLAW_OTEL=on needs OTEL_EXPORTER_OTLP_ENDPOINT, the collector to send to',
      {
        variable: 'OTEL_EXPORTER_OTLP_ENDPOINT',
      },
    )
  }
  const port = blankToUndefined(env.THEOCLAW_PROMETHEUS_PORT)
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) {
    throw new TheoClawConfigError('THEOCLAW_PROMETHEUS_PORT must be an integer from 0 to 65535', {
      variable: 'THEOCLAW_PROMETHEUS_PORT',
    })
  }
  const anonymous = blankToUndefined(env.THEOCLAW_ANONYMOUS_TELEMETRY)
  if (anonymous !== undefined && anonymous !== 'on' && anonymous !== 'off') {
    throw new TheoClawConfigError('THEOCLAW_ANONYMOUS_TELEMETRY must be on or off', {
      variable: 'THEOCLAW_ANONYMOUS_TELEMETRY',
    })
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
export function agentTelemetry(settings: TelemetrySettings): {
  readonly telemetry?: AgentTelemetry
} {
  return settings.enabled
    ? {
        telemetry: {
          enabled: true,
          serviceName: settings.serviceName,
          includeContent: false,
          autoDetect: false,
        },
      }
    : {}
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

/** A URL's userinfo is a credential an exporter error or a log line may quote. */
function mask(text: string): string {
  return redactSecrets(text).replace(/\/\/[^/@\s]+@/g, '//***@')
}

const NOTHING_REGISTERED: RegisteredTelemetry = {
  log: () => undefined,
  prometheusEndpoint: Promise.resolve(undefined),
  flush: async () => undefined,
  shutdown: async () => undefined,
}

/**
 * Register the global tracer and meter providers, and a logger, through the SDK, with OTLP/HTTP
 * exporters behind a batch processor and a periodic reader, so an export never runs on the turn
 * path (FR-006, NFR-004). Nothing is registered while telemetry is off. The anonymous meter, with
 * its own constant resource, stays here: the SDK registers one resource only.
 */
export async function registerTelemetry(
  settings: TelemetrySettings,
  options: RegisterTelemetryOptions,
): Promise<RegisteredTelemetry> {
  if (!settings.enabled) return NOTHING_REGISTERED
  // Agent factories read settings even in the TUI and other telemetry-disabled processes.
  // Keep the optional host exporters off that startup path.
  const { OTLPLogExporter } = await import('@opentelemetry/exporter-logs-otlp-http')
  const report = (line: string): void =>
    options.write(`theoclaw: telemetry export failed: ${line.replace(/\s+/g, ' ').trim()}`)
  let sdk: Awaited<ReturnType<typeof registerSdkTelemetry>>
  try {
    sdk = await registerSdkTelemetry({
      endpoint: settings.endpoint,
      serviceName: settings.serviceName,
      ...(settings.prometheusPort === undefined ? {} : { prometheusPort: settings.prometheusPort }),
      exportTimeoutMs: EXPORT_TIMEOUT_MS,
      metricIntervalMs: METRIC_INTERVAL_MS,
      onExportError: report,
      logExporter:
        options.logExporter ??
        new OTLPLogExporter({
          url: `${settings.endpoint}/v1/logs`,
          timeoutMillis: EXPORT_TIMEOUT_MS,
        }),
      // The app's SpanExporter is sdk-trace-base 2.x's; the SDK types its option against its own
      // copy of that package, a structurally identical interface (export/shutdown/forceFlush), so
      // the cast only bridges two installed copies of the same type.
      ...(options.spanExporter === undefined
        ? {}
        : { spanExporter: options.spanExporter as never }),
      ...(options.metricExporter === undefined ? {} : { metricExporter: options.metricExporter }),
    })
  } catch (error) {
    // Another caller owns the global providers: leave them alone and run without ours.
    if ((error as { code?: unknown }).code !== 'telemetry_provider_registered') throw error
    report('a tracer or meter provider is already registered in this process')
    return NOTHING_REGISTERED
  }
  // A failed listen reports once and leaves the endpoint undefined.
  const prometheusEndpoint = sdk.prometheusEndpoint.catch((error: unknown) => {
    report(error instanceof Error ? error.message : String(error))
    return undefined
  })
  // A separate, constant resource avoids profile names, host ids and user identifiers.
  const anonymousProvider = settings.anonymous
    ? new MeterProvider({
        resource: resourceFromAttributes({ 'service.name': 'theoclaw-anonymous' }),
        readers: [
          new PeriodicExportingMetricReader({
            exporter:
              options.anonymousMetricExporter ??
              new OTLPMetricExporter({
                url: `${settings.endpoint}/v1/metrics`,
                timeoutMillis: EXPORT_TIMEOUT_MS,
              }),
            exportIntervalMillis: METRIC_INTERVAL_MS,
          }),
        ],
      })
    : undefined
  anonymousProvider
    ?.getMeter('theoclaw-anonymous')
    .createCounter('theoclaw_anonymous_starts')
    .add(1)
  return {
    log: (line) => sdk.log({ body: mask(line), severityText: 'INFO' }),
    prometheusEndpoint,
    flush: async () => {
      await Promise.allSettled([
        sdk.flush(),
        ...(anonymousProvider ? [anonymousProvider.forceFlush()] : []),
      ])
    },
    shutdown: async () => {
      await prometheusEndpoint
      // The SDK disables the diag channel before it stops the providers, so flush while a failure can still be reported.
      await sdk.flush()
      await Promise.allSettled([
        sdk.shutdown(),
        ...(anonymousProvider ? [anonymousProvider.shutdown()] : []),
      ])
    },
  }
}
