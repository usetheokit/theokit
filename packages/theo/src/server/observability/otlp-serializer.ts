/**
 * Lightweight OTLP JSON serializer — ~50 LoC, no @opentelemetry/* dependency.
 *
 * Per ADR D456: in-house serializer for the theo-cloud adapter.
 * Produces valid ExportTraceServiceRequest JSON (OTLP v1.0).
 * Pinned to OTLP JSON v1.0 (stable since 2023).
 */
import type { SpanData } from './span.js'

interface OtlpSpan {
  traceId: string
  spanId: string
  /** Omitted on the root span — OTLP reads an absent parent as "this is the root". */
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: {
    key: string
    value: { stringValue?: string; intValue?: string; boolValue?: boolean }
  }[]
  status: { code: number; message?: string }
}

interface ExportTraceServiceRequest {
  resourceSpans: [
    {
      scopeSpans: [
        {
          scope: { name: string; version: string }
          spans: OtlpSpan[]
        },
      ]
    },
  ]
}

interface OtlpAttributeValue {
  stringValue?: string
  intValue?: string
  boolValue?: boolean
}

/**
 * OTLP's `AnyValue`: one field filled in, the others absent.
 *
 * It was an inline nested ternary (agent-builder#319). Extracted with a `switch`, and not flattened
 * into a cleverer ternary, because OTLP's type list is open — `arrayValue`, `doubleValue` and
 * `kvlistValue` exist in the spec and are not emitted here yet. With the `switch`, each becomes a new
 * `case`; with the ternary, each would become one more level of nesting.
 */
function paraValorOtlp(value: string | number | boolean): OtlpAttributeValue {
  switch (typeof value) {
    case 'string':
      return { stringValue: value }
    case 'number':
      return { intValue: String(value) }
    default:
      return { boolValue: value }
  }
}

/** Convert SpanData[] to OTLP JSON bytes (Uint8Array). */
export function serializeSpansToOtlp(spans: SpanData[], serviceName = 'theokit'): Uint8Array {
  const otlpSpans: OtlpSpan[] = spans.map((s) => ({
    // #368 — read, never minted. This used to call `randomHex` for both, which
    // gave every span a trace of its own and made a multi-span run unreadable at
    // the collector. The ids now arrive on the span, decided when it started.
    traceId: s.traceId,
    spanId: s.spanId,
    ...(s.parentSpanId === undefined ? {} : { parentSpanId: s.parentSpanId }),
    name: s.name,
    kind: 2, // SPAN_KIND_SERVER
    startTimeUnixNano: String(s.startTimeMs * 1_000_000),
    endTimeUnixNano: String((s.endTimeMs ?? s.startTimeMs) * 1_000_000),
    attributes: Object.entries(s.attributes).map(([key, value]) => ({
      key,
      value: paraValorOtlp(value),
    })),
    status: { code: s.status === 'ok' ? 1 : 2, message: s.statusMessage },
  }))

  const request: ExportTraceServiceRequest = {
    resourceSpans: [
      {
        scopeSpans: [
          {
            scope: { name: serviceName, version: '1.0.0' },
            spans: otlpSpans,
          },
        ],
      },
    ],
  }

  return new TextEncoder().encode(JSON.stringify(request))
}
