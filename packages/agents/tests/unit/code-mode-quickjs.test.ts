import { describe, expect, it, vi } from 'vitest'

import type { CodeModeApi } from '../../src/code-mode-entry.js'
import { CodeModeSandboxError, createQuickJsSandbox } from '../../src/code-mode-quickjs-entry.js'

/** The rejection of `promise`, which must reject. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the run to reject, and it resolved')
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await rejectionOf(promise)
  expect(error).toBeInstanceOf(CodeModeSandboxError)
  return (error as CodeModeSandboxError).code
}

const addApi: CodeModeApi = {
  add: async (args) => (args as { x: number }).x,
}

describe('createQuickJsSandbox', () => {
  it('returns what the script returns after two awaited api calls', async () => {
    const sandbox = createQuickJsSandbox()

    const result = await sandbox.run(
      'const a = await api.add({ x: 1 }); const b = await api.add({ x: 2 }); return a + b',
      addApi,
    )

    expect(result).toBe(3)
  })

  it('lets the script catch a host tool error', async () => {
    const sandbox = createQuickJsSandbox()
    const api: CodeModeApi = {
      read_file: async () => {
        throw new Error('ENOENT: no such file')
      },
    }

    const result = await sandbox.run(
      'try { await api.read_file({ path: "x" }); return "read" } catch (e) { return "caught: " + e.message }',
      api,
    )

    expect(result).toBe('caught: ENOENT: no such file')
  })

  it('sees no require, process, fetch or setTimeout inside the script', async () => {
    const sandbox = createQuickJsSandbox()

    const result = await sandbox.run(
      'return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.global]',
      {},
    )

    expect(result).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined'])
  })

  it('rejects a throwing script with script_error', async () => {
    const sandbox = createQuickJsSandbox()
    const run = sandbox.run('throw new Error("the script gave up")', {})

    const error = await rejectionOf(run)

    expect(error).toBeInstanceOf(CodeModeSandboxError)
    expect((error as CodeModeSandboxError).code).toBe('script_error')
    expect((error as Error).message).toContain('the script gave up')
  })

  it('rejects a script with a syntax error as script_error', async () => {
    const sandbox = createQuickJsSandbox()

    await expect(codeOf(sandbox.run('return (', {}))).resolves.toBe('script_error')
  })

  it('rejects an unserialisable result', async () => {
    const sandbox = createQuickJsSandbox()

    await expect(codeOf(sandbox.run('return function f() {}', {}))).resolves.toBe(
      'unserialisable_result',
    )
  })

  it('rejects a cyclic result as unserialisable_result, through the VM JSON.stringify', async () => {
    const sandbox = createQuickJsSandbox()

    const error = await rejectionOf(
      sandbox.run('const node = {}; node.self = node; return node', {}),
    )

    expect(error).toBeInstanceOf(CodeModeSandboxError)
    expect((error as CodeModeSandboxError).code).toBe('unserialisable_result')
    // The VM's own reason, not the typeof branch's "the script returned a <kind>".
    expect((error as Error).message).not.toContain('the script returned a')
  })

  it('rejects a bigint result as unserialisable_result', async () => {
    const sandbox = createQuickJsSandbox()

    const error = await rejectionOf(sandbox.run('return 1n', {}))

    expect((error as CodeModeSandboxError).code).toBe('unserialisable_result')
    expect((error as Error).message).toContain('the script returned a bigint')
  })

  it('interrupts an infinite loop with timeout', async () => {
    const sandbox = createQuickJsSandbox({ timeoutMs: 200 })
    const started = Date.now()

    await expect(codeOf(sandbox.run('while (true) {}', {}))).resolves.toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1200)
  })

  it('rejects an allocation past the memory limit', async () => {
    const sandbox = createQuickJsSandbox({ memoryLimitBytes: 4_194_304 })

    await expect(
      codeOf(
        sandbox.run(
          'const a = []; while (true) { a.push({ i: a.length, s: "y" + a.length }) }',
          {},
        ),
      ),
    ).resolves.toBe('memory_limit')
  })

  it('refuses the call past the call limit without calling the host', async () => {
    const sandbox = createQuickJsSandbox({ maxCalls: 2 })
    const add = vi.fn(async () => 1)

    const code = await codeOf(
      sandbox.run('await api.add({}); await api.add({}); await api.add({}); return 0', { add }),
    )

    expect(code).toBe('call_limit')
    expect(add).toHaveBeenCalledTimes(2)
  })

  it('ends with call_limit even when the script catches the refused call', async () => {
    const sandbox = createQuickJsSandbox({ maxCalls: 0 })
    const add = vi.fn(async () => 1)

    await expect(
      codeOf(
        sandbox.run('try { await api.add({}) } catch (e) { return "caught" } return 0', { add }),
      ),
    ).resolves.toBe('call_limit')
    expect(add).not.toHaveBeenCalled()
  })

  it('runs a script normally after a failed run on the same sandbox', async () => {
    const sandbox = createQuickJsSandbox({ memoryLimitBytes: 4_194_304, timeoutMs: 4000 })

    await expect(
      codeOf(sandbox.run('const a = []; while (true) { a.push({ s: "y" + a.length }) }', {})),
    ).resolves.toBe('memory_limit')

    await expect(sandbox.run('return 6 * 7', {})).resolves.toBe(42)
  })

  it('starts each run in a fresh context', async () => {
    const sandbox = createQuickJsSandbox()

    await sandbox.run('globalThis.leaked = 1; return 0', {})
    const second = await sandbox.run('return typeof globalThis.leaked', {})

    expect(second).toBe('undefined')
  })

  it('times out a host call that never settles', async () => {
    const sandbox = createQuickJsSandbox({ timeoutMs: 200 })
    const started = Date.now()
    const api: CodeModeApi = { web_fetch: () => new Promise<never>(() => undefined) }

    await expect(
      codeOf(sandbox.run('return await api.web_fetch({ url: "x" })', api)),
    ).resolves.toBe('timeout')
    expect(Date.now() - started).toBeLessThan(1200)
  })

  it('keeps the typed code when a run fails with live handles', async () => {
    const pending: CodeModeApi = { web_fetch: () => new Promise<never>(() => undefined) }

    const timedOut = createQuickJsSandbox({ timeoutMs: 200 }).run(
      'const p = api.web_fetch({}); const q = api.web_fetch({}); return await p',
      pending,
    )
    const outOfMemory = createQuickJsSandbox({ memoryLimitBytes: 4_194_304 }).run(
      'const p = api.web_fetch({}); const a = []; while (true) { a.push({ i: a.length, s: "y" + a.length }) }',
      pending,
    )

    // Both observed at once: awaiting one first would leave the other's rejection unhandled.
    await expect(Promise.all([codeOf(timedOut), codeOf(outOfMemory)])).resolves.toEqual([
      'timeout',
      'memory_limit',
    ])
  })

  it('returns null for a script that returns nothing', async () => {
    const sandbox = createQuickJsSandbox()

    await expect(sandbox.run('const unused = 1', {})).resolves.toBeNull()
  })

  it('passes an empty object for an api call with no argument', async () => {
    const sandbox = createQuickJsSandbox()
    const list_dir = vi.fn(async () => 'listed')

    await sandbox.run('return await api.list_dir()', { list_dir })

    // The second argument is the run's own signal, which every host call receives.
    expect(list_dir).toHaveBeenCalledWith({}, { signal: expect.any(AbortSignal) as unknown })
  })

  it('hands the script the raw string when the host result is not JSON', async () => {
    const sandbox = createQuickJsSandbox()
    const api: CodeModeApi = {
      read_file: async () => 'plain text, not JSON',
      list_dir: async () => '{"entries":["a.txt"]}',
    }

    const result = await sandbox.run(
      'const text = await api.read_file({}); const dir = await api.list_dir({}); return [text, dir.entries[0]]',
      api,
    )

    expect(result).toEqual(['plain text, not JSON', 'a.txt'])
  })

  it('returns each run its own result when two run at once on one sandbox', async () => {
    const sandbox = createQuickJsSandbox()

    const [one, two] = await Promise.all([
      sandbox.run('globalThis.n = 1; await api.add({ x: 1 }); return globalThis.n', addApi),
      sandbox.run('globalThis.n = 2; await api.add({ x: 2 }); return globalThis.n', addApi),
    ])

    expect([one, two]).toEqual([1, 2])
  })

  it('ends a run with cancelled when its signal aborts during a host call, and aborts that call', async () => {
    const sandbox = createQuickJsSandbox({ timeoutMs: 5000 })
    const controller = new AbortController()
    let hostSignal: AbortSignal | undefined
    const api: CodeModeApi = {
      web_fetch: (_args, options) => {
        hostSignal = options?.signal
        setImmediate(() => {
          controller.abort()
        })
        return new Promise<never>(() => undefined)
      },
    }
    const started = Date.now()

    const code = await codeOf(
      sandbox.run('return await api.web_fetch({ url: "x" })', api, { signal: controller.signal }),
    )

    expect(code).toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(hostSignal?.aborted).toBe(true)
  })

  it('refuses to start a run whose signal already aborted', async () => {
    const sandbox = createQuickJsSandbox()
    const add = vi.fn(async () => 1)

    const code = await codeOf(
      sandbox.run('return await api.add({})', { add }, { signal: AbortSignal.abort() }),
    )

    expect(code).toBe('cancelled')
    expect(add).not.toHaveBeenCalled()
  })
})
