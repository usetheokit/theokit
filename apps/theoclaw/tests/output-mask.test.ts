import { Console } from 'node:console'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { EmailAdapter } from '@theokit/gateway-email'
import { LineAdapter } from '@theokit/gateway-line'

import { TheoClawConfigError, installOutputMask } from '../src/channels/output-mask.js'
import type { MaskableStream, OutputMask } from '../src/channels/output-mask.js'

/** A stream that keeps every byte written to it. */
function capturingStream(): MaskableStream & { readonly bytes: () => Buffer; readonly text: () => string } {
  const chunks: Buffer[] = []
  const stream = {
    write: ((chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown) => {
      chunks.push(
        typeof chunk === 'string'
          ? Buffer.from(chunk, typeof encodingOrCallback === 'string' ? (encodingOrCallback as BufferEncoding) : 'utf8')
          : Buffer.from(chunk),
      )
      const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
      if (typeof done === 'function') done()
      return true
    }) as NodeJS.WriteStream['write'],
    bytes: () => Buffer.concat(chunks),
    text: () => Buffer.concat(chunks).toString('utf8'),
  }
  return stream
}

let mask: OutputMask | undefined
const originalStderrWrite = process.stderr.write

afterEach(() => {
  mask?.uninstall()
  mask = undefined
  process.stderr.write = originalStderrWrite
  vi.restoreAllMocks()
})

/** Put a capturing writer under process.stderr, then the mask over it, as the app's order does. */
function maskStderr(secrets: readonly string[]): () => string {
  const capture = capturingStream()
  process.stderr.write = capture.write
  mask = installOutputMask(secrets, [process.stderr])
  return capture.text
}

describe('installOutputMask', () => {
  it('masks a credential the real LINE adapter writes on a failed connect', async () => {
    const captured = maskStderr(['line-token-123'])
    const adapter = new LineAdapter({
      channelSecret: 'line-secret',
      channelAccessToken: 'line-token-123',
      __clientFactory: () => ({
        getBotInfo: async () => {
          throw new Error('401 Unauthorized for token line-token-123')
        },
      }),
      // The construction seam exists at runtime and is not in the published options type.
    } as ConstructorParameters<typeof LineAdapter>[0])

    expect(await adapter.connect()).toBe(false)

    expect(captured()).toContain('connect failed')
    expect(captured()).not.toContain('line-token-123')
  })

  it('masks a credential the real email adapter logs on a failed connect', async () => {
    // vitest replaces the global console with one that never calls process.stderr.write; Node's
    // own Console over the process streams is what the adapter's console.error reaches in production.
    const nodeConsole = new Console(process.stdout, process.stderr)
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => nodeConsole.error(...args))
    const captured = maskStderr(['mail-pass-456'])
    const adapter = new EmailAdapter({
      address: 'bot@example.org',
      password: 'mail-pass-456',
      imapHost: 'imap.example.org',
      smtpHost: 'smtp.example.org',
      __smtpFactory: () => ({
        verify: async () => {
          throw new Error('535 authentication failed for mail-pass-456')
        },
        close: async () => undefined,
      }),
      __imapFactory: () => ({ disconnect: async () => undefined }),
      // The construction seams exist at runtime and are not in the published options type.
    } as ConstructorParameters<typeof EmailAdapter>[0])

    expect(await adapter.connect()).toBe(false)

    expect(captured()).toContain('connect failed')
    expect(captured()).not.toContain('mail-pass-456')
  })

  it('uninstall restores the original writers', () => {
    const capture = capturingStream()
    process.stderr.write = capture.write
    const installed = installOutputMask(['x-secret'], [process.stderr])

    installed.uninstall()

    expect(process.stderr.write).toBe(capture.write)
  })

  it('masks a credential split across two writes', () => {
    const capture = capturingStream()
    mask = installOutputMask(['mail-pass-456'], [capture])

    capture.write('user mail-pass-')
    capture.write('456 done')

    expect(capture.text()).toBe('user [redacted] done')
  })

  it('flush emits a held tail that never completed', () => {
    const capture = capturingStream()
    mask = installOutputMask(['mail-pass-456'], [capture])

    capture.write('x mail-pa')
    mask.flush()

    expect(capture.text()).toBe('x mail-pa')
  })

  it('output without a credential prefix is not delayed', () => {
    const capture = capturingStream()
    mask = installOutputMask(['mail-pass-456'], [capture])

    capture.write('plain line\n')

    expect(capture.text()).toBe('plain line\n')
  })

  it('masks a credential written as hex', () => {
    const capture = capturingStream()
    mask = installOutputMask(['line-token-123'], [capture])

    capture.write(Buffer.from('line-token-123').toString('hex'), 'hex')

    expect(capture.text()).toBe('[redacted]')
  })

  it('masks a credential written as base64', () => {
    const capture = capturingStream()
    mask = installOutputMask(['line-token-123'], [capture])

    capture.write(Buffer.from('line-token-123').toString('base64'), 'base64')

    expect(capture.text()).toBe('[redacted]')
  })

  it('masks a buffer chunk', () => {
    const capture = capturingStream()
    mask = installOutputMask(['line-token-123'], [capture])

    capture.write(Buffer.from('x line-token-123 y'))

    expect(capture.text()).toBe('x [redacted] y')
  })

  it('passes bytes that are not valid UTF-8 through unchanged', () => {
    const capture = capturingStream()
    mask = installOutputMask(['line-token-123'], [capture])

    capture.write(Buffer.from([0xff, 0xfe, 0x00]))

    expect([...capture.bytes()]).toEqual([0xff, 0xfe, 0x00])
  })

  it('uninstall emits the held tail before restoring', () => {
    const capture = capturingStream()
    const installed = installOutputMask(['mail-pass-456'], [capture])

    capture.write('x mail-pa')
    installed.uninstall()

    expect(capture.text()).toBe('x mail-pa')
  })

  it('masks a multi-byte credential split inside a character', () => {
    const secret = 'senha-çã€-9'
    const bytes = Buffer.from(`a ${secret} z`)
    for (let cut = 1; cut < bytes.length; cut += 1) {
      const capture = capturingStream()
      const installed = installOutputMask([secret], [capture])
      capture.write(bytes.subarray(0, cut))
      capture.write(bytes.subarray(cut))
      installed.uninstall()
      expect(capture.text()).toBe('a [redacted] z')
    }
  })

  it('masks a credential split across two hex writes', () => {
    const capture = capturingStream()
    mask = installOutputMask(['line-token-123'], [capture])
    const hex = Buffer.from('<line-token-123>').toString('hex')

    capture.write(hex.slice(0, 12), 'hex')
    capture.write(hex.slice(12), 'hex')

    expect(capture.text()).toBe('<[redacted]>')
  })

  it('calls the callback of a write that is held back whole', () => {
    const capture = capturingStream()
    mask = installOutputMask(['mail-pass-456'], [capture])
    const done = vi.fn()

    capture.write('mail-pa', done)

    expect(done).toHaveBeenCalledTimes(1)
    expect(capture.text()).toBe('')
  })

  it('masks stdout and stderr by default', () => {
    const out = capturingStream()
    const err = capturingStream()
    const originalStdoutWrite = process.stdout.write
    process.stdout.write = out.write
    process.stderr.write = err.write
    try {
      const installed = installOutputMask(['x-secret-1'])
      process.stdout.write('out x-secret-1\n')
      process.stderr.write('err x-secret-1\n')
      installed.uninstall()
    } finally {
      process.stdout.write = originalStdoutWrite
    }

    expect(out.text()).toBe('out [redacted]\n')
    expect(err.text()).toBe('err [redacted]\n')
  })

  it('holds a short credential that may be the start of a longer one', () => {
    const capture = capturingStream()
    mask = installOutputMask(['abc', 'abcdef'], [capture])

    capture.write('x:abc')
    capture.write('def|')

    expect(capture.text()).toBe('x:[redacted]|')
  })

  it('an old handle uninstalled twice leaves a newer mask in place', () => {
    const capture = capturingStream()
    const first = installOutputMask(['zz-secret'], [capture])
    first.uninstall()
    mask = installOutputMask(['zz-secret'], [capture])

    first.uninstall()
    capture.write('zz-secret|')

    expect(capture.text()).toBe('[redacted]|')
  })

  it('refuses the same stream listed twice', () => {
    const capture = capturingStream()

    expect(() => installOutputMask(['x-secret'], [capture, capture])).toThrow(TheoClawConfigError)
  })

  it('refuses to install twice on the same stream', () => {
    const capture = capturingStream()
    mask = installOutputMask(['x-secret'], [capture])

    expect(() => installOutputMask(['x-secret'], [capture])).toThrow(TheoClawConfigError)
  })

  it('calls the write callback', () => {
    const capture = capturingStream()
    mask = installOutputMask(['x-secret'], [capture])
    const done = vi.fn()

    capture.write('line\n', done)

    expect(done).toHaveBeenCalledTimes(1)
  })
})
