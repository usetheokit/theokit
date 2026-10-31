import 'reflect-metadata'

import { homedir } from 'node:os'

import { Agent } from '@theokit/sdk'

import { startTheoClaw } from './composition.js'
import { type CreateAgent, createAgentFactory } from './control-plane/agent-factory.js'
import { describeError } from './control-plane/errors.js'
import { applyInstance, resolveInstance, type TheoClawInstance } from './instance.js'

/**
 * The process entry: the real environment, signals, exit and output streams, and the `/control`
 * turns' agents built by the SDK with the model key passed explicitly and the published tools the
 * start resolved. Chat sessions' agents are opened by `startTheoClaw` itself through
 * `Agent.getOrCreate`, with the same protected options and no tool, in `THEOCLAW_WORKSPACE`.
 * Everything else is `startTheoClaw`'s, which the tests drive with stand-ins;
 * `tests/control-plane-process.test.ts` drives this file from outside the process.
 *
 * The instance comes first (B-514, plan D2): `THEOCLAW_PROFILE` is resolved and applied to the real
 * environment before `startTheoClaw` runs, so no agent exists while the SDK still reads the shared
 * home. Each `/control` agent works in the profile's `workspace`, and the profile sets
 * `THEOCLAW_WORKSPACE` to it, so the chat sessions keep their transcripts there too. Nothing imports this file, so
 * `tests/live/instance-profiles.live.test.ts` is what proves the order.
 */
function fail(error: unknown): never {
  process.stderr.write(`theoclaw: ${describeError(error)}\n`)
  process.exit(1)
}

let instance: TheoClawInstance
try {
  instance = resolveInstance(process.env, { homeDir: homedir() })
  applyInstance(instance, process.env)
} catch (error) {
  fail(error)
}
// Best effort: the kernel keeps the title within the original command line's length.
process.title = instance.label

const workspace = instance.workspace
const create: CreateAgent = (options) =>
  Agent.create({ ...options, ...(workspace === undefined ? {} : { local: { cwd: workspace } }) })

startTheoClaw({
  env: process.env,
  instance,
  agentFactory: createAgentFactory(process.env, create),
  signals: process,
  exit: (code) => process.exit(code),
}).catch(fail)
