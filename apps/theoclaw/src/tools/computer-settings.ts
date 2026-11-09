import { accessSync, closeSync, constants, fstatSync, openSync, readSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { SandboxMode } from '@theokit/agents/sandbox'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { readXwdHeader, XwdFormatError } from './xwd.js'

type Env = Readonly<Record<string, string | undefined>>

const VARIABLE = 'THEOCLAW_COMPUTER'
const HEADER_BYTES = 100

/** What the `computer` tool runs against, resolved and checked once at start (B-676 D2, D3). */
export interface ComputerSettings {
  readonly display: string
  /** The XWD file Xvfb keeps up to date under `-fbdir`. */
  readonly framebuffer: string
  /** The absolute path of the `xdotool` executable. */
  readonly xdotool: string
}

/** What the tests inject; the process passes nothing. */
export interface ComputerDeps {
  readonly findExecutable?: (name: string, pathVar: string) => string | undefined
}

function refusal(reason: string): TheoClawConfigError {
  return new TheoClawConfigError(`${VARIABLE}=on ${reason}`, { variable: VARIABLE })
}

function refuse(reason: string): never {
  throw refusal(reason)
}

/** The first `PATH` entry holding an executable regular file called `name`. */
function findOnPath(name: string, pathVar: string): string | undefined {
  for (const dir of pathVar.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not here or not executable: the next entry may hold it.
    }
  }
  return undefined
}

/** The first bytes of the framebuffer file; a file that is missing, a directory or unreadable is refused. */
function readFramebufferHead(path: string): Buffer {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    if (!fstatSync(descriptor).isFile()) throw refusal(`needs THEOCLAW_COMPUTER_FRAMEBUFFER to name a regular file; ${path} is not one`)
    const head = Buffer.alloc(HEADER_BYTES)
    const read = readSync(descriptor, head, 0, HEADER_BYTES, 0)
    return head.subarray(0, read)
  } catch (error) {
    if (error instanceof TheoClawConfigError) throw error
    throw refusal(`could not read THEOCLAW_COMPUTER_FRAMEBUFFER ${path}: ${(error as Error).message}`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function checkFramebuffer(path: string): void {
  try {
    readXwdHeader(readFramebufferHead(path), path)
  } catch (error) {
    if (!(error instanceof XwdFormatError)) throw error
    refuse(`needs an Xvfb -fbdir framebuffer: ${error.message}`)
  }
}

/**
 * `THEOCLAW_COMPUTER`: unset or empty is off; `on` checks, in order, host tools, the sandbox mode,
 * `DISPLAY`, `xdotool` and the framebuffer, refusing the start with the first one missing (D2);
 * anything else is refused.
 */
export function readComputer(
  env: Env,
  posture: { readonly hostTools: boolean; readonly sandboxMode: SandboxMode },
  deps: ComputerDeps = {},
): ComputerSettings | undefined {
  const value = env[VARIABLE]
  if (value === undefined || value === '') return undefined
  if (value !== 'on') throw new TheoClawConfigError(`${VARIABLE} must be "on" or unset, not "${value}"`, { variable: VARIABLE })
  checkPosture(posture)
  const display = trimmed(env, 'DISPLAY')
  if (display === '') refuse('needs DISPLAY: no X display is named')
  const xdotool = (deps.findExecutable ?? findOnPath)('xdotool', trimmed(env, 'PATH'))
  if (xdotool === undefined) refuse('needs xdotool on PATH: install it (for example apt install xdotool)')
  const framebuffer = trimmed(env, 'THEOCLAW_COMPUTER_FRAMEBUFFER')
  if (framebuffer === '') refuse('needs THEOCLAW_COMPUTER_FRAMEBUFFER: the XWD file Xvfb keeps under -fbdir, such as <dir>/Xvfb_screen0')
  checkFramebuffer(framebuffer)
  return { display, framebuffer, xdotool }
}

function trimmed(env: Env, name: string): string {
  return env[name]?.trim() ?? ''
}

/** The tool drives the host display outside the sandbox: it needs the host tools and never runs under `read-only`. */
function checkPosture(posture: { readonly hostTools: boolean; readonly sandboxMode: SandboxMode }): void {
  if (!posture.hostTools) refuse('needs THEOCLAW_HOST_TOOLS=on: the tool drives the host display outside the sandbox')
  if (posture.sandboxMode === 'read-only') {
    refuse('is refused with THEOCLAW_SANDBOX=read-only: the tool types into windows on the host; unset THEOCLAW_COMPUTER or choose workspace-write')
  }
}

/** The start line that says whether the computer tool is on. */
export function computerLine(settings: ComputerSettings | undefined): string {
  return settings === undefined
    ? 'tools: computer is off (THEOCLAW_COMPUTER unset)'
    : `tools: computer is on (display ${settings.display}, framebuffer ${settings.framebuffer})`
}
