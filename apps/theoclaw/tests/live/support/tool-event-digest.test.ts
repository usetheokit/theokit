import { describe, expect, it } from 'vitest'
import { toolEventDigest } from './tool-event-digest.js'

describe('toolEventDigest', () => {
  it('keeps each call name, status and the whole output, however long', () => {
    const output = `${'x'.repeat(5000)}END`
    const digest = toolEventDigest([
      { type: 'tool_call', name: 'mcp_browser_browser_navigate', status: 'running', args: { url: 'http://127.0.0.1:1/' } },
      { type: 'tool_call', name: 'mcp_browser_browser_navigate', status: 'completed', output },
    ])
    const lines = digest.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('#0 mcp_browser_browser_navigate [running]')
    expect(lines[1]).toContain('#1 mcp_browser_browser_navigate [completed]')
    expect(lines[1]).toContain(`${output}"`)
  })
})
