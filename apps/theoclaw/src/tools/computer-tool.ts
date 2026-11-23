import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

import { Tool, ToolError } from '@theokit/sdk'
import type { CustomTool } from '@theokit/sdk'
import { z } from 'zod'

import type { TurnAgent } from '../agent-port.js'
import { describeError } from '../control-plane/errors.js'
import { runWorker } from './code-mode-tools.js'
import type { ComputerSettings } from './computer-settings.js'
import { readXwdHeader, xwdToPng } from './xwd.js'

type Env = Readonly<Record<string, string | undefined>>

const XDOTOOL_TIMEOUT_MS = 5000
const DESCRIBE_TIMEOUT_MS = 60_000
const TYPE_DELAY_MS = '12'
const MAX_TEXT = 500
// Any character below U+0020 or U+007F: a newline would press Return in whatever window has focus (EC-1).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u

const inputSchema = z.object({
  action: z.enum(['screenshot', 'mouse_move', 'left_click', 'type']),
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  text: z
    .string()
    .min(1)
    .max(MAX_TEXT)
    .refine((text) => !CONTROL_CHARACTER.test(text), 'text must not contain a control character (newline, tab, escape or delete)')
    .optional(),
  question: z.string().max(MAX_TEXT).optional(),
})

type Input = z.infer<typeof inputSchema>

/** What the tests inject; the process passes nothing. */
export interface ComputerToolDeps {
  /** Run `file` with `argv` and `env`, resolve with its stdout, reject with the cause in the message. */
  readonly run?: (file: string, argv: readonly string[], env: Env, signal?: AbortSignal) => Promise<string>
  readonly readFile?: (path: string) => Buffer
}

const execFileAsync = promisify(execFile)

/** `execFile`, never a shell; a non-zero exit or a timeout rejects with stderr or the timeout as the message. */
async function execute(file: string, argv: readonly string[], env: Env, signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileAsync(file, [...argv], {
      env: env as NodeJS.ProcessEnv,
      timeout: XDOTOOL_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })
    return stdout
  } catch (error) {
    const failure = error as Error & { stderr?: string; killed?: boolean }
    const stderr = failure.stderr?.trim() ?? ''
    throw new Error(stderr !== '' ? stderr : failure.killed === true ? `timed out after ${XDOTOOL_TIMEOUT_MS} ms` : failure.message)
  }
}

/** The environment xdotool runs in: the display and the path, nothing of the process's secrets. */
function xdotoolEnv(settings: ComputerSettings): Env {
  const { PATH, XAUTHORITY } = process.env
  return { DISPLAY: settings.display, ...(PATH === undefined ? {} : { PATH }), ...(XAUTHORITY === undefined ? {} : { XAUTHORITY }) }
}

function fail(action: string, reason: string): ToolError {
  return new ToolError(`computer ${action} failed: ${reason}`)
}

function invalid(field: string, reason: string): ToolError {
  return new ToolError(`computer: ${field} ${reason}`)
}

/** `x` and `y` when both are given; one alone, or one off the screen, names the field. */
function pointOf(input: Input, screen: { readonly width: number; readonly height: number }, required: boolean): [number, number] | undefined {
  const { x, y } = input
  if (x === undefined && y === undefined && !required) return undefined
  if (x === undefined) throw invalid('x', `is required with ${input.action === 'mouse_move' ? 'mouse_move' : 'y'}`)
  if (y === undefined) throw invalid('y', `is required with ${input.action === 'mouse_move' ? 'mouse_move' : 'x'}`)
  if (x >= screen.width) throw invalid('x', `${x} is off the screen, which is ${screen.width} pixels wide`)
  if (y >= screen.height) throw invalid('y', `${y} is off the screen, which is ${screen.height} pixels high`)
  return [x, y]
}

const LOCATION = /x:(\d+)\s+y:(\d+)/

function describePrompt(question: string | undefined, width: number, height: number): string {
  return (
    question ??
    `Describe what is on this screen and give the pixel coordinates (x, y from the top-left of a ${width}x${height} screen) of each window, text box and button you see.`
  )
}

/**
 * The `computer` tool: pointer and keys through `xdotool` by argument vector (D3), and screenshots
 * decoded from the Xvfb framebuffer and shown to a tool-less agent on a user turn, whose text the
 * tool returns (D1). `buildDescriber` is the `/control` agent's own factory with no tools.
 */
export function computerTool(settings: ComputerSettings, buildDescriber: () => Promise<TurnAgent>, deps: ComputerToolDeps = {}): CustomTool {
  const run = deps.run ?? execute
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path))
  const xdotool = (argv: readonly string[], signal: AbortSignal | undefined): Promise<string> =>
    run(settings.xdotool, argv, xdotoolEnv(settings), signal)

  // One host pointer and keyboard: an action's xdotool sequence (move, click, read back) runs whole
  // before the next one starts, so parallel tool calls cannot land a click at another call's point.
  let queue: Promise<unknown> = Promise.resolve()
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }

  async function pointerLocation(action: string, signal: AbortSignal | undefined): Promise<string> {
    const match = LOCATION.exec(await xdotool(['getmouselocation'], signal))
    if (match === null) throw fail(action, 'unreadable pointer location')
    return `pointer at x:${match[1]} y:${match[2]}`
  }

  async function screenshot(input: Input, signal: AbortSignal | undefined): Promise<string> {
    const action = 'screenshot'
    try {
      const { png, width, height } = xwdToPng(readFile(settings.framebuffer), settings.framebuffer)
      const message = {
        text: describePrompt(input.question, width, height),
        images: [{ data: png.toString('base64'), mimeType: 'image/png' }],
      }
      const bound = AbortSignal.timeout(DESCRIBE_TIMEOUT_MS)
      const outcome = await runWorker(buildDescriber, message, signal === undefined ? bound : AbortSignal.any([signal, bound]))
      return `screen ${width}x${height}\n${outcome.response}`
    } catch (error) {
      throw fail(action, describeError(error))
    }
  }

  async function pointerAction(input: Input, signal: AbortSignal | undefined): Promise<string> {
    const { action } = input
    let screen: { readonly width: number; readonly height: number }
    try {
      screen = readXwdHeader(readFile(settings.framebuffer), settings.framebuffer)
    } catch (error) {
      throw fail(action, describeError(error))
    }
    const point = pointOf(input, screen, action === 'mouse_move')
    try {
      if (point !== undefined) await xdotool(['mousemove', String(point[0]), String(point[1])], signal)
      if (action === 'left_click') await xdotool(['click', '1'], signal)
    } catch (error) {
      throw fail(action, describeError(error))
    }
    return pointerLocation(action, signal).catch((error: unknown) => {
      throw error instanceof ToolError ? error : fail(action, describeError(error))
    })
  }

  async function typeText(input: Input, signal: AbortSignal | undefined): Promise<string> {
    if (input.text === undefined) throw invalid('text', 'is required with type')
    try {
      await xdotool(['type', '--delay', TYPE_DELAY_MS, '--', input.text], signal)
    } catch (error) {
      throw fail('type', describeError(error))
    }
    return `typed ${input.text.length} characters`
  }

  return Tool.create({
    name: 'computer',
    description:
      'Look at and drive the X desktop. Actions: screenshot (a description of the screen with pixel coordinates; optional question), ' +
      'mouse_move (x, y), left_click (x and y, or neither to click where the pointer is), type (text, no control characters). ' +
      'Coordinates are screen pixels from the top-left.',
    inputSchema,
    handler: (input, context) => {
      const signal = context?.signal
      switch (input.action) {
        case 'screenshot':
          return screenshot(input, signal)
        case 'type':
          return serialized(() => typeText(input, signal))
        default:
          return serialized(() => pointerAction(input, signal))
      }
    },
  })
}
