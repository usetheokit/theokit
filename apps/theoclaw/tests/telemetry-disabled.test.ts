import { describe, expect, it, vi } from 'vitest'

// Importing agent settings must not load the optional host exporters. Throwing mocks make
// this deterministic: no timing threshold or live model is involved.
vi.mock('@opentelemetry/exporter-logs-otlp-http', () => { throw new Error('loaded log exporter while telemetry was off') })
vi.mock('@opentelemetry/sdk-logs', () => { throw new Error('loaded log SDK while telemetry was off') })
vi.mock('@opentelemetry/exporter-prometheus', () => { throw new Error('loaded Prometheus exporter while telemetry was off') })

import { agentOptionsFor } from '../src/control-plane/agent-factory.js'
import { readTelemetrySettings, registerTelemetry } from '../src/telemetry/otel.js'

describe('telemetry-disabled startup', () => {
  it('reads agent settings and starts without loading optional exporters', async () => {
    expect(agentOptionsFor({ THEOCLAW_MODEL: 'stub', THEOKIT_API_KEY: 'stub-key' })).not.toHaveProperty('telemetry')
    const registered = await registerTelemetry(readTelemetrySettings({}), { write: () => undefined })
    registered.log('local operational line')
    expect(await registered.prometheusEndpoint).toBeUndefined()
    await registered.flush()
    await registered.shutdown()
  })
})
