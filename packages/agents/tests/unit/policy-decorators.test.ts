import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Reflector } from '@theokit/http'
import { RequiresApproval } from '../../src/decorators/policies.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'

const reflector = new Reflector()

describe('Policy decorators', () => {
  it('test_requires_approval_on_tool', () => {
    @Toolbox({ namespace: 'billing' })
    class BillingTools {
      @Tool({ name: 'refund', description: 'Refund', input: z.object({}) })
      @RequiresApproval({ reason: 'Refunds affect billing' })
      async refund() {
        return ''
      }
    }

    const approval = reflector.get(RequiresApproval, BillingTools, 'refund')
    expect(approval).toEqual({ reason: 'Refunds affect billing' })
  })
})
