import { describe, expect, it } from 'vitest'

import { readMcpEventsSettings } from '../src/triggers/mcp-events-settings.js'

const SERVERS = { feed: { url: 'http://127.0.0.1:1/mcp' }, local: { command: '/bin/true' } } as never

describe('readMcpEventsSettings', () => {
  it('is off while the reply target is unset', () => {
    expect(readMcpEventsSettings({}, ['telegram'], SERVERS)).toBeUndefined()
  })
  it('takes every HTTP server of the external tools by default', () => {
    const settings = readMcpEventsSettings({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram:42', THEOCLAW_MCP_EVENTS_TYPES: 'a, b', THEOCLAW_MCP_EVENTS_PORT: '9000' }, ['telegram'], SERVERS)
    expect(settings?.servers.map((server) => server.name)).toEqual(['feed'])
    expect(settings?.replyTo).toEqual({ platform: 'telegram', channelId: '42' })
    expect(settings?.events).toEqual(['a', 'b'])
    expect(settings?.port).toBe(9000)
  })
  it('refuses an unconfigured platform, a missing channel, a stdio or unknown server, and no server', () => {
    const read = (env: Record<string, string>, servers: never = SERVERS) => () => readMcpEventsSettings(env, ['telegram'], servers)
    expect(read({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'slack:1' })).toThrow(/not configured/)
    expect(read({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram' })).toThrow(/no channel id/)
    expect(read({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram:1', THEOCLAW_MCP_EVENTS_SERVERS: 'local' })).toThrow(/not an HTTP server/)
    expect(read({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram:1', THEOCLAW_MCP_EVENTS_SERVERS: 'nope' })).toThrow(/does not define/)
    expect(read({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram:1' }, {} as never)).toThrow(/no HTTP MCP server/)
    expect(read({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram:1', THEOCLAW_MCP_EVENTS_CALLBACK_ORIGIN: 'nonsense' })).toThrow(/not an origin/)
    expect(read({ THEOCLAW_MCP_EVENTS_REPLY_TO: 'telegram:1', THEOCLAW_MCP_EVENTS_PORT: 'x' })).toThrow(/port/)
  })
})
