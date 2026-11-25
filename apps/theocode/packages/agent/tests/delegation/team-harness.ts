import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

import { createDelegateToTeamTool } from '../../src/delegation/squad.js'

/** A member run whose `wait()` follows `behaviour`, recording every `cancel()`. */
export function fakeMember(opts: {
  never?: boolean
  crash?: string
  dispose?: () => Promise<void>
  cancelled?: string[]
  name: string
}) {
  return {
    send: vi.fn(async () => ({
      cancel: async () => {
        opts.cancelled?.push(opts.name)
      },
      wait: () =>
        opts.crash !== undefined
          ? Promise.resolve({ status: 'error', error: new Error(opts.crash) })
          : opts.never === true
            ? new Promise<never>(() => {})
            : Promise.resolve({ status: 'finished', result: `${opts.name} done` }),
    })),
    dispose: opts.dispose ?? (async () => {}),
  }
}

export async function runTool(): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'theocode-team-'))
  try {
    return await invoke(cwd)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

function invoke(cwd: string): Promise<string> {
  const tool = createDelegateToTeamTool({
    model: 'm',
    reasoning_effort: undefined,
    sandbox_mode: 'workspace-write',
    posture: 'trusted',
    cwd,
  } as never) as unknown as { handler: (i: { task: string }) => Promise<string> }
  return tool.handler({ task: 'do it' })
}
