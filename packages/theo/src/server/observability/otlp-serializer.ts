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
 * O `AnyValue` do OTLP: um dos campos preenchido, os outros ausentes.
 *
 * Era um ternário aninhado inline (agent-builder#319). Extraído com `switch`, e não achatado num
 * ternário mais esperto, porque a lista de tipos do OTLP é aberta — `arrayValue`, `doubleValue` e
 * `kvlistValue` existem na spec e ainda não são emitidos aqui. Com o `switch`, cada um vira um `case`
 * novo; com o ternário, viraria mais um nível de aninhamento.
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
    traceId: randomHex(32),
    spanId: randomHex(16),
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

function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
