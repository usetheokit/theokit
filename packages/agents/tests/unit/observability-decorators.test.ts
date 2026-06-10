import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Reflector } from '@theokit/http-decorators'
import { Trace, Audit } from '../../src/decorators/observability.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'

const reflector = new Reflector()

describe('Observability decorators', () => {
  it('test_trace_on_toolbox', () => {
    @Toolbox()
    @Trace(true)
    class TracedTools {}

    expect(reflector.get(Trace, TracedTools)).toBe(true)
  })

  it('test_audit_on_tool', () => {
    @Toolbox()
    class Tools {
      @Tool({ name: 'refund', description: 'Refund', input: z.object({}) })
      @Audit(true)
      async refund() { return '' }
    }

    expect(reflector.get(Audit, Tools, 'refund')).toBe(true)
  })

  it('test_no_trace_returns_undefined', () => {
    @Toolbox()
    class Tools {}

    expect(reflector.get(Trace, Tools)).toBeUndefined()
  })
})
