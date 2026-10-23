import 'reflect-metadata'

import { startTheoClaw } from './composition.js'
import { createAgentFactory } from './control-plane/agent-factory.js'
import { describeError } from './control-plane/errors.js'

/**
 * The process entry: the real environment, signals, exit and output streams, and agents built by
 * the SDK with the model key passed explicitly. Everything else is `startTheoClaw`'s, which the
 * tests drive with stand-ins; `tests/control-plane-process.test.ts` drives this file from outside
 * the process.
 */
startTheoClaw({
  env: process.env,
  agentFactory: createAgentFactory(process.env),
  signals: process,
  exit: (code) => process.exit(code),
}).catch((error: unknown) => {
  process.stderr.write(`theoclaw: ${describeError(error)}\n`)
  process.exit(1)
})
