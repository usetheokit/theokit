import { describe, expect, it } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { agentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'

describe('bundled skills (OC-74)', () => {
  it('offers summarize-text with skill_read to every agent', () => {
    const options = theoClawAgentOptions({
      model: 'm',
      apiKey: 'k',
      toolOptions: agentToolOptions(resolveToolSettings({}, process.cwd(), { detect: () => ({ enforced: false, reason: 'test' }) as never })),
    })
    expect(options.skills?.inline.map((skill) => skill.name)).toContain('summarize-text')
    expect(options.tools?.map((tool) => tool.name)).toContain('skill_read')
  })
})
