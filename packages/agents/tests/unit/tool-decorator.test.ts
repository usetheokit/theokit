import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Toolbox, Tool, getToolboxConfig, getToolMethods, getToolConfig } from '../../src/decorators/tool.js'

describe('@Toolbox + @Tool decorators', () => {
  it('test_toolbox_stores_namespace', () => {
    @Toolbox({ namespace: 'support' })
    class SupportTools {}

    expect(getToolboxConfig(SupportTools)).toEqual({ namespace: 'support' })
  })

  it('test_toolbox_default_empty_namespace', () => {
    @Toolbox()
    class BasicTools {}

    expect(getToolboxConfig(BasicTools)).toEqual({})
  })

  it('test_tool_stores_config', () => {
    const inputSchema = z.object({ query: z.string() })

    @Toolbox({ namespace: 'support' })
    class SupportTools {
      @Tool({ name: 'search_tickets', description: 'Search tickets', input: inputSchema, risk: 'low' })
      async searchTickets() { return '' }
    }

    const config = getToolConfig(SupportTools, 'searchTickets')
    expect(config).toBeDefined()
    expect(config!.name).toBe('search_tickets')
    expect(config!.description).toBe('Search tickets')
    expect(config!.risk).toBe('low')
    expect(config!.input).toBe(inputSchema)
  })

  it('test_tool_methods_accumulated', () => {
    @Toolbox({ namespace: 'support' })
    class SupportTools {
      @Tool({ name: 'search', description: 'Search', input: z.object({}) })
      async search() { return '' }

      @Tool({ name: 'refund', description: 'Refund', input: z.object({}) })
      async refund() { return '' }
    }

    const methods = getToolMethods(SupportTools)
    expect(methods).toEqual(['search', 'refund'])
  })

  it('test_tool_with_empty_schema', () => {
    const emptySchema = z.object({})

    @Toolbox()
    class Tools {
      @Tool({ name: 'ping', description: 'Ping', input: emptySchema })
      async ping() { return 'pong' }
    }

    const config = getToolConfig(Tools, 'ping')
    expect(config!.input).toBe(emptySchema)
  })

  it('test_no_toolbox_returns_undefined', () => {
    class PlainClass {}
    expect(getToolboxConfig(PlainClass)).toBeUndefined()
    expect(getToolMethods(PlainClass)).toEqual([])
  })
})
