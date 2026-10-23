import 'reflect-metadata'

import { startTheoClaw } from './composition.js'
import { createAgentFactory } from './control-plane/agent-factory.js'
import { describeError } from './control-plane/errors.js'

/**
 * The process entry: the real environment, signals and exit, and agents built by the SDK with the
 * model key passed explicitly. Everything else is `startTheoClaw`'s, which the tests drive with
 * stand-ins; `tests/control-plane-process.test.ts` drives this file from outside the process.
 */
startTheoClaw({
  env: process.env,
  agentFactory: createAgentFactory(process.env),
  stdout: (line) => void process.stdout.write(`${line}\n`),
  stderr: (line) => void process.stderr.write(`${line}\n`),
  signals: process,
  exit: (code) => process.exit(code),
}).catch((error: unknown) => {
  process.stderr.write(`theoclaw: ${describeError(error)}\n`)
  process.exit(1)
})
