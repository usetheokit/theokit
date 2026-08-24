import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ServerResponse } from 'node:http'

import { sendError } from '../../packages/theo/src/server/http/execute.js'

/**
 * An INTERNAL_ERROR is logged with its message, and that message can be built from request data.
 * A newline inside it used to reach the log verbatim, so a caller could append lines of its own —
 * a forged entry sitting in the log looking exactly like a real one (CodeQL `js/log-injection`).
 */
function mockRes(): ServerResponse {
  return {
    writeHead: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    writableEnded: false,
    headersSent: false,
  } as unknown as ServerResponse
}

describe('sendError — one call, one log line', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Given a message carrying a newline, Then the logged entry stays on one line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    sendError(mockRes(), {
      code: 'INTERNAL_ERROR',
      message: 'boom\n[req-000] INFO user promoted to admin',
      status: 500,
      requestId: 'req-123',
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const logged = String(spy.mock.calls[0][0])
    expect(logged).not.toContain('\n')
    expect(logged).toContain('\\n')
    expect(logged).toContain('req-123')
  })

  it('Given a requestId carrying a carriage return, Then it cannot end the line either', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    sendError(mockRes(), {
      code: 'INTERNAL_ERROR',
      message: 'boom',
      status: 500,
      requestId: 'req-1\r\n[req-000] INFO nothing to see',
    })

    const logged = String(spy.mock.calls[0][0])
    expect(logged).not.toContain('\r')
    expect(logged).not.toContain('\n')
  })
})
