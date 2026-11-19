import type { CustomTool } from '@theokit/sdk'
import { expectTypeOf, it } from 'vitest'

import { declareAgentShape, shapeToolsAsCustomTools } from '../../src/capability/agent-shape.js'
import { ToolsCapability } from '../../src/capability/capabilities.js'

declare const customTools: CustomTool[]

it('ToolsCapability takes the SDK CustomTool with no cast', () => {
  const cap = new ToolsCapability(customTools)
  expectTypeOf(cap).toEqualTypeOf<ToolsCapability>()
})

it('the tools of a shape come back as CustomTool with no cast', () => {
  const shape = declareAgentShape('a', [new ToolsCapability(customTools)])
  const back = shapeToolsAsCustomTools(shape)
  expectTypeOf(back).toEqualTypeOf<readonly CustomTool[]>()
  const accept = (_t: readonly CustomTool[]): void => undefined
  accept(back)
})
