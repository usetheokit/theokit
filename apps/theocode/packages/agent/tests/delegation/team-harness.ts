import { vi } from 'vitest'

import { createDelegateToTeamTool } from '../../src/delegation/squad.js'

/** A member run whose `wait()` follows `behaviour`, recording every `cancel()`. */
export function fakeMember(opts: {
  never?: boolean
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
        opts.never === true
          ? new Promise<never>(() => {})
          : Promise.resolve({ status: 'finished', result: `${opts.name} done` }),
    })),
    dispose: opts.dispose ?? (async () => {}),
  }
}

export function runTool(): Promise<string> {
  const tool = createDelegateToTeamTool({
    model: 'm',
    reasoning_effort: undefined,
    sandbox_mode: 'workspace-write',
    posture: 'trusted',
    cwd: process.cwd(),
  } as never) as unknown as { handler: (i: { task: string }) => Promise<string> }
  return tool.handler({ task: 'do it' })
}
