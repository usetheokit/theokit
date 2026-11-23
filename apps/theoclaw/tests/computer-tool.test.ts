import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import type { TurnAgent, TurnMessage, TurnRun } from '../src/agent-port.js'
import { createChannelAgentFactory } from '../src/control-plane/agent-factory.js'
import type { TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { computerTool } from '../src/tools/computer-tool.js'
import type { ComputerToolDeps } from '../src/tools/computer-tool.js'
import type { ComputerSettings } from '../src/tools/computer-settings.js'
import { agentToolOptions, controlAgentToolOptions, workerToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced } from './tool-start-fixtures.js'
import { buildXwd } from './xwd-fixtures.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const WIDTH = 4
const SETTINGS: ComputerSettings = { display: ':99', framebuffer: '/fb/Xvfb_screen0', xdotool: '/usr/bin/xdotool' }
const SCREEN = buildXwd({ width: WIDTH, height: 1 })

interface Call {
  readonly file: string
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly signal: AbortSignal | undefined
}

/** A runner that records every call and answers `getmouselocation` with the last `mousemove`. */
function fakeRunner(overrides: { readonly fail?: Error; readonly location?: string } = {}) {
  const calls: Call[] = []
  let pointer = ['0', '0']
  const run: NonNullable<ComputerToolDeps['run']> = async (file, argv, env, signal) => {
    calls.push({ file, argv, env, signal })
    if (overrides.fail !== undefined) throw overrides.fail
    if (argv[0] === 'mousemove') pointer = [argv[1] ?? '0', argv[2] ?? '0']
    if (argv[0] === 'getmouselocation') return overrides.location ?? `x:${pointer[0]} y:${pointer[1]} screen:0 window:1`
    return ''
  }
  return { calls, run }
}

interface DescriberLog {
  built: number
  messages: TurnMessage[]
  disposed: number
  signal: AbortSignal | undefined
}

/** A tool-less describer; `behaviour` decides how its run ends. */
function fakeDescriber(behaviour: 'answers' | 'errors' | 'hangs', answer = 'a window at 10,20') {
  const log: DescriberLog = { built: 0, messages: [], disposed: 0, signal: undefined }
  const build = async (): Promise<TurnAgent> => {
    log.built++
    const agent = {
      send: async (message: TurnMessage, options?: { readonly signal?: AbortSignal }): Promise<TurnRun> => {
        log.messages.push(message)
        log.signal = options?.signal
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => (release = resolve))
        let cancelled = false
        return {
          stream: async function* () {
            if (behaviour === 'hangs') await gate
            if (behaviour === 'errors') yield { type: 'error' }
          },
          wait: async () => {
            if (behaviour === 'hangs') await gate
            if (cancelled) return { status: 'cancelled' }
            return behaviour === 'errors' ? { status: 'error' } : { status: 'finished', result: answer }
          },
          cancel: async () => {
            cancelled = true
            release()
          },
        }
      },
      [Symbol.asyncDispose]: async () => {
        log.disposed++
      },
    }
    return agent as unknown as TurnAgent
  }
  return { build, log }
}

function build(deps: ComputerToolDeps, describer = fakeDescriber('answers')): CustomTool {
  return computerTool(SETTINGS, describer.build, { readFile: () => SCREEN, ...deps })
}

async function expectToolError(tool: CustomTool, input: Record<string, unknown>, ...parts: string[]): Promise<void> {
  for (const part of parts) await expect(tool.handler(input, { signal: new AbortController().signal })).rejects.toThrow(part)
}

describe('the computer tool: arguments', () => {
  it('rejects an unsupported action or a coordinate off the screen and runs nothing', async () => {
    const runner = fakeRunner()
    const tool = build({ run: runner.run })
    await expectToolError(tool, { action: 'drag' }, 'action')
    await expectToolError(tool, { action: 'mouse_move', x: 5000, y: 0 }, 'x')
    await expectToolError(tool, { action: 'mouse_move', x: 1 }, 'y')
    await expectToolError(tool, { action: 'left_click', x: 1 }, 'y')
    await expectToolError(tool, { action: 'type' }, 'text')
    await expectToolError(tool, { action: 'mouse_move', x: -1, y: 0 }, 'x')
    expect(runner.calls).toEqual([])
  })

  it('refuses typed text holding a control character', async () => {
    const runner = fakeRunner()
    const tool = build({ run: runner.run })
    for (const text of ['ls\n', 'a\tb', 'x\u007f', 'cr\r']) {
      await expectToolError(tool, { action: 'type', text }, 'text')
    }
    expect(runner.calls).toEqual([])
  })

  it('accepts x width-1 and refuses x width', async () => {
    const runner = fakeRunner()
    const tool = build({ run: runner.run })
    await expect(tool.handler({ action: 'mouse_move', x: WIDTH - 1, y: 0 }, {})).resolves.toContain(`x:${WIDTH - 1}`)
    const before = runner.calls.length
    await expectToolError(tool, { action: 'mouse_move', x: WIDTH, y: 0 }, 'x', String(WIDTH))
    expect(runner.calls).toHaveLength(before)
  })
})

describe('the computer tool: xdotool', () => {
  it('runs xdotool with an argument vector and reports the pointer location', async () => {
    const runner = fakeRunner()
    const result = await build({ run: runner.run }).handler({ action: 'mouse_move', x: 3, y: 0 }, {})
    expect(runner.calls.map((call) => [call.file, call.argv])).toEqual([
      [SETTINGS.xdotool, ['mousemove', '3', '0']],
      [SETTINGS.xdotool, ['getmouselocation']],
    ])
    expect(runner.calls[0]?.env.DISPLAY).toBe(':99')
    expect(result).toBe('pointer at x:3 y:0')
  })

  it('clicks at a position, or where the pointer is when none is given', async () => {
    const runner = fakeRunner()
    const tool = build({ run: runner.run })
    await tool.handler({ action: 'left_click', x: 2, y: 0 }, {})
    expect(runner.calls.map((call) => call.argv[0])).toEqual(['mousemove', 'click', 'getmouselocation'])
    expect(runner.calls[1]?.argv).toEqual(['click', '1'])
    runner.calls.length = 0
    await tool.handler({ action: 'left_click' }, {})
    expect(runner.calls.map((call) => call.argv[0])).toEqual(['click', 'getmouselocation'])
  })

  it('passes -- before typed text', async () => {
    const runner = fakeRunner()
    await build({ run: runner.run }).handler({ action: 'type', text: '-rf' }, {})
    expect(runner.calls.map((call) => call.argv)).toEqual([['type', '--delay', '12', '--', '-rf']])
  })

  it('passes the turn signal to xdotool and no secret of the process environment', async () => {
    const secretName = 'THEOCLAW_COMPUTER_TEST_SECRET'
    process.env[secretName] = 'do-not-leak'
    const runner = fakeRunner()
    const controller = new AbortController()
    try {
      await build({ run: runner.run }).handler({ action: 'type', text: 'a' }, { signal: controller.signal })
    } finally {
      delete process.env[secretName]
    }
    expect(runner.calls[0]?.signal).toBe(controller.signal)
    expect(Object.keys(runner.calls[0]?.env ?? {})).not.toContain(secretName)
  })

  it('runs concurrent pointer and keyboard actions one at a time, in call order', async () => {
    const calls: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run: NonNullable<ComputerToolDeps['run']> = async (_file, argv) => {
      calls.push(argv.join(' '))
      if (argv[0] === 'mousemove') await gate
      return argv[0] === 'getmouselocation' ? 'x:1 y:0 screen:0 window:1' : ''
    }
    const tool = build({ run })
    const move = tool.handler({ action: 'mouse_move', x: 1, y: 0 }, {})
    const typed = tool.handler({ action: 'type', text: 'a' }, {})
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual(['mousemove 1 0'])
    release()
    await Promise.all([move, typed])
    expect(calls).toEqual(['mousemove 1 0', 'getmouselocation', 'type --delay 12 -- a'])
  })

  it('keeps serving actions after one in the queue failed', async () => {
    const runner = fakeRunner({ fail: new Error('Cannot open display') })
    const tool = build({ run: runner.run })
    const first = tool.handler({ action: 'type', text: 'a' }, {})
    const second = tool.handler({ action: 'type', text: 'b' }, {})
    await expect(first).rejects.toThrow('computer type failed')
    await expect(second).rejects.toThrow('computer type failed')
    expect(runner.calls).toHaveLength(2)
  })

  it('reports an unreadable pointer location as a tool error', async () => {
    const runner = fakeRunner({ location: 'garbage' })
    const outcome = build({ run: runner.run }).handler({ action: 'mouse_move', x: 1, y: 0 }, {})
    await expect(outcome).rejects.toThrow('computer mouse_move failed: unreadable pointer location')
  })

  it.each([
    ['exits non-zero', new Error('Cannot open display: :99')],
    ['times out', new Error('timed out after 5000 ms')],
  ])('reports an xdotool run that %s as a tool error naming the action', async (_how, failure) => {
    const runner = fakeRunner({ fail: failure })
    const outcome = build({ run: runner.run }).handler({ action: 'type', text: 'hi' }, {})
    await expect(outcome).rejects.toThrow(`computer type failed: ${failure.message}`)
  })
})

describe('the computer tool: screenshot', () => {
  it('answers a screenshot with one image sent to a tool-less agent on a user turn', async () => {
    const describer = fakeDescriber('answers')
    const result = await build({}, describer).handler({ action: 'screenshot' }, {})
    expect(describer.log.built).toBe(1)
    expect(describer.log.messages).toHaveLength(1)
    const message = describer.log.messages[0] as Exclude<TurnMessage, string>
    expect(message.images).toHaveLength(1)
    expect(message.images[0]?.mimeType).toBe('image/png')
    expect(Buffer.from(message.images[0]?.data ?? '', 'base64').subarray(1, 4).toString()).toBe('PNG')
    expect(message.text).toContain('4x1')
    expect(result).toBe('screen 4x1\na window at 10,20')
    expect(describer.log.disposed).toBe(1)
  })

  it('asks the model question when one is given', async () => {
    const describer = fakeDescriber('answers')
    await build({}, describer).handler({ action: 'screenshot', question: 'What is the code?' }, {})
    expect((describer.log.messages[0] as Exclude<TurnMessage, string>).text).toContain('What is the code?')
  })

  it('disposes the describer when its run fails, and names the screenshot', async () => {
    const describer = fakeDescriber('errors')
    await expect(build({}, describer).handler({ action: 'screenshot' }, {})).rejects.toThrow('computer screenshot failed')
    expect(describer.log.disposed).toBe(1)
  })

  it('stops the describer when the turn is cancelled', async () => {
    const describer = fakeDescriber('hangs')
    const controller = new AbortController()
    const pending = build({}, describer).handler({ action: 'screenshot' }, { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()
    await expect(pending).rejects.toThrow('computer screenshot failed')
    expect(describer.log.disposed).toBe(1)
    expect(describer.log.signal?.aborted).toBe(true)
  })

  it('reports an unreadable framebuffer as a tool error naming the screenshot', async () => {
    const tool = computerTool(SETTINGS, fakeDescriber('answers').build, { readFile: () => Buffer.alloc(10) })
    await expect(tool.handler({ action: 'screenshot' }, {})).rejects.toThrow('computer screenshot failed')
  })
})

describe('who holds the computer tool', () => {
  function settingsWithComputer(): ReturnType<typeof resolveToolSettings> {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const dir = mkdtempSync(join(tmpdir(), 'theoclaw-fb-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const framebuffer = join(dir, 'Xvfb_screen0')
    writeFileSync(framebuffer, SCREEN)
    const environment = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_COMPUTER: 'on', DISPLAY: ':99', THEOCLAW_COMPUTER_FRAMEBUFFER: framebuffer }
    return resolveToolSettings(environment, workspace.path, {
      detect: enforced,
      warn: () => undefined,
      computer: { findExecutable: () => '/usr/bin/xdotool' },
    })
  }

  const names = (tools: readonly CustomTool[]): string[] => tools.map((tool) => tool.name)
  const noAgent = (): TurnAgent => ({ send: () => Promise.reject(new Error('not used')) })

  it('gives the control agent a computer tool only when on and never a chat agent', async () => {
    const on = settingsWithComputer()
    expect(names(controlAgentToolOptions(on, noAgent).tools)).toContain('computer')
    expect(names(workerToolOptions(on).tools)).not.toContain('computer')
    expect(names(agentToolOptions(on).tools)).not.toContain('computer')
    const { computer: _computer, ...off } = on
    expect(names(controlAgentToolOptions(off, noAgent).tools)).not.toContain('computer')
    const created: TheoClawAgentOptions[] = []
    const create = async (options: TheoClawAgentOptions) => {
      created.push(options)
      return options
    }
    await createChannelAgentFactory(
      { THEOCLAW_MODEL: 'openrouter/m', OPENROUTER_API_KEY: 'k', THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_COMPUTER: 'on' },
      create,
    )()
    expect(JSON.stringify(created)).not.toContain('computer')
  })

  it('builds the describer with no tools, through the control agent factory', async () => {
    const on = settingsWithComputer()
    const built: unknown[] = []
    const options = controlAgentToolOptions(on, (toolOptions) => {
      built.push(toolOptions)
      return noAgent()
    })
    const tool = options.tools.find((candidate) => candidate.name === 'computer') as CustomTool
    await Promise.resolve(tool.handler({ action: 'screenshot' }, {})).catch(() => undefined)
    expect(built).toHaveLength(1)
    expect(built[0]).toMatchObject({ tools: [], plugins: [] })
  })
})
