import type { CustomTool } from '@theokit/sdk'
import { createComputerTool } from '@theokit/sdk-tools'

import type { TurnAgent } from '../agent-port.js'
import { runWorker } from './code-mode-tools.js'
import type { ComputerSettings } from './computer-settings.js'

/** What the tests inject; the process passes nothing. */
export interface ComputerToolDeps {
  /** Run `file` with `argv` and `env`, resolve with its stdout, reject with the cause in the message. */
  readonly run?: (file: string, argv: readonly string[], env: Readonly<Record<string, string>>, signal?: AbortSignal) => Promise<string>
  readonly readFile?: (path: string) => Buffer
}

function describePrompt(question: string | undefined, width: number, height: number): string {
  return (
    question ??
    `Describe what is on this screen and give the pixel coordinates (x, y from the top-left of a ${width}x${height} screen) of each window, text box and button you see.`
  )
}

/**
 * The `computer` tool, from `createComputerTool` in `@theokit/sdk-tools`: pointer and keys through
 * `xdotool`, and screenshots shown to a tool-less agent on a user turn, whose text the tool returns
 * (D1). `buildDescriber` is the `/control` agent's own factory with no tools. `left_click` needs
 * both `x` and `y`; there is no click at the pointer.
 */
export function computerTool(settings: ComputerSettings, buildDescriber: () => Promise<TurnAgent>, deps: ComputerToolDeps = {}): CustomTool {
  return createComputerTool({
    display: settings.display,
    framebuffer: settings.framebuffer,
    xdotool: settings.xdotool,
    ...(deps.run === undefined ? {} : { run: deps.run }),
    ...(deps.readFile === undefined ? {} : { readFile: deps.readFile }),
    describe: async (png, { width, height, question, signal }) => {
      const message = {
        text: describePrompt(question, width, height),
        images: [{ data: png.toString('base64'), mimeType: 'image/png' }],
      }
      return (await runWorker(buildDescriber, message, signal)).response
    },
  })
}
