import 'reflect-metadata'

import { homedir } from 'node:os'

import { Agent } from '@theokit/sdk'
import type { SDKAgent } from '@theokit/sdk'

import { startTheoClaw } from './composition.js'
import type { AgentImport, TheoClawAgentOptions } from './agent/create-agent.js'
import { type CreateAgent, createAgentFactory, createChannelAgentFactory } from './control-plane/agent-factory.js'
import { loadConfiguration } from './config-file.js'
import { describeError } from './control-plane/errors.js'
import { applyInstance, resolveInstance, type TheoClawInstance } from './instance.js'
import { importedSetupLine, readImportAtStart, requireImportedMcp } from './migration/import-start.js'

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
 * `THEOCLAW_WORKSPACE` to it, so the chat sessions keep their transcripts there too. A migration
 * import under `THEOCLAW_STATE_DIR` is read right after, and handed to the `/control` agents only.
 * Nothing imports this file, so
 * `tests/live/instance-profiles.live.test.ts` is what proves the order.
 */
function fail(error: unknown): never {
  process.stderr.write(`theoclaw: ${describeError(error)}\n`)
  process.exit(1)
}

let instance: TheoClawInstance
let imported: AgentImport | undefined
try {
  // The configuration file first (B-374): it fills only what the environment leaves unset.
  loadConfiguration(process.env, homedir())
  instance = resolveInstance(process.env, { homeDir: homedir() })
  applyInstance(instance, process.env)
  // After the instance, so a profile's own state directory is the one read (FR-010, FR-011).
  const mcp = requireImportedMcp(process.env)
  const setup = readImportAtStart(process.env, (line) => process.stderr.write(`${line}\n`))
  imported = setup === undefined ? undefined : { setup, mcp }
} catch (error) {
  fail(error)
}
// Best effort: the kernel keeps the title within the original command line's length.
process.title = instance.label

const workspace = instance.workspace
const createSdkAgent = (options: TheoClawAgentOptions): Promise<SDKAgent> =>
  Agent.create({ ...options, ...(workspace === undefined ? {} : { local: { cwd: workspace } }) })
const create: CreateAgent = createSdkAgent

startTheoClaw({
  env: process.env,
  instance,
  // The import reaches the `/control` agents only; WebChat's and the chat path's factories take none (FR-009).
  agentFactory: createAgentFactory(process.env, create, imported),
  webchatAgentFactory: createAgentFactory(process.env, create),
  ...(imported === undefined ? {} : { importedLine: importedSetupLine(imported.setup, imported.mcp) }),
  // The `digest` tool's draft agents (B-387): the chat path's factory, so no tool, no shell, memory off.
  draftAgentFactory: createChannelAgentFactory(process.env, createSdkAgent),
  signals: process,
  exit: (code) => process.exit(code),
}).catch(fail)
