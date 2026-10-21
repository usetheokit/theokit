import { Agent } from '@theokit/sdk'

import { startTheoClaw } from './composition.js'

/**
 * The process entry: real environment, real signals, real exit, an agent per message built by the
 * SDK. Everything it does is `startTheoClaw`'s, which the tests drive with injected stand-ins.
 */
startTheoClaw({
  env: process.env,
  agentFactory: () => Agent.create({ model: (process.env.THEOCLAW_MODEL ?? '').trim() }),
  signals: process,
  exit: (code) => process.exit(code),
}).catch((error: unknown) => {
  process.stderr.write(`theoclaw: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
