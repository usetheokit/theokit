import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Reflector } from '@theokit/http'
import { RequiresApproval, RequiresCapability, Budget, Policy } from '../../src/decorators/policies.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'

const reflector = new Reflector()

describe('Policy decorators', () => {
  it('test_requires_approval_on_tool', () => {
    @Toolbox({ namespace: 'billing' })
    class BillingTools {
      @Tool({ name: 'refund', description: 'Refund', input: z.object({}) })
      @RequiresApproval({ reason: 'Refunds affect billing' })
      async refund() { return '' }
    }

    const approval = reflector.get(RequiresApproval, BillingTools, 'refund')
    expect(approval).toEqual({ reason: 'Refunds affect billing' })
  })

  it('test_requires_capability_on_tool', () => {
    @Toolbox()
    class Tools {
      @Tool({ name: 'delete', description: 'Delete', input: z.object({}) })
      @RequiresCapability(['admin:delete', 'billing:refund'])
      async delete() { return '' }
    }

    const caps = reflector.get(RequiresCapability, Tools, 'delete')
    expect(caps).toEqual(['admin:delete', 'billing:refund'])
  })

  it('test_budget_on_agent_class', () => {
    @Agent({ name: 'test', route: '/test' })
    @Budget({ maxCostUsd: 1.00, window: 'daily' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const budget = reflector.get(Budget, TestAgent)
    expect(budget).toEqual({ maxCostUsd: 1.00, window: 'daily' })
  })

  it('test_budget_tool_overrides_agent_via_reflector', () => {
    @Agent({ name: 'test', route: '/test' })
    @Budget({ maxCostUsd: 1.00 })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    @Toolbox()
    class Tools {
      @Tool({ name: 'expensive', description: 'Expensive', input: z.object({}) })
      @Budget({ maxCostUsd: 0.20 })
      async expensive() { return '' }
    }

    // Method-level on toolbox overrides — getAllAndOverride checks method first
    const toolBudget = reflector.getAllAndOverride(Budget, Tools, 'expensive')
    expect(toolBudget).toEqual({ maxCostUsd: 0.20 })

    // Agent-level budget
    const agentBudget = reflector.get(Budget, TestAgent)
    expect(agentBudget).toEqual({ maxCostUsd: 1.00 })
  })

  it('test_policy_handler_on_tool', () => {
    const isAdmin = (user: { roles: string[] }) => user.roles.includes('admin')

    @Toolbox()
    class Tools {
      @Tool({ name: 'danger', description: 'Dangerous', input: z.object({}) })
      @Policy([isAdmin])
      async danger() { return '' }
    }

    const policies = reflector.get(Policy, Tools, 'danger')
    expect(policies).toHaveLength(1)
    expect(policies![0]({ roles: ['admin'] })).toBe(true)
    expect(policies![0]({ roles: ['user'] })).toBe(false)
  })
})
