import './runtime.js'
import 'reflect-metadata'

import { homedir } from 'node:os'

import { Agent } from '@theokit/sdk'
import type { SDKAgent } from '@theokit/sdk'

import { startTheoClaw } from './composition.js'
import { resolveSecretRefs } from './secret-refs.js'
import { createObjectGenerator } from './workflows/object-generator.js'
import type { AgentImport, TheoClawAgentOptions } from './agent/create-agent.js'
import { type CreateAgent, createAgentFactory, createChannelAgentFactory } from './control-plane/agent-factory.js'
import { loadConfiguration } from './config-file.js'
import { teeToLogFile } from './ops/log-tee.js'
import { watchConfiguration } from './ops/hot-reload.js'
import { RESTART_EXIT_CODE, spawnSuccessor, supervised, waitForPredecessor } from './ops/self-restart.js'
import { parseEntryArguments } from './entry-arguments.js'
import { describeError } from './control-plane/errors.js'
import { resolveInstance, type TheoClawInstance } from './instance.js'
import { importedMcpPaths, importedMcpSecrets, importedSetupLine, readImportAtStart, requireImportedMcp } from './migration/import-start.js'
import { applyProxyEnvironment } from './ops/proxy.js'
import { claimInstance } from './backup/instance-lock.js'
import { readTelemetrySettings, registerTelemetry, type RegisteredTelemetry } from './telemetry/otel.js'

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
/** How long the exit waits for telemetry to export what is pending. */
const TELEMETRY_SHUTDOWN_MS = 2_000

function fail(error: unknown): never {
  process.stderr.write(`theoclaw: ${describeError(error)}\n`)
  process.exit(1)
}

// A successor of a self-restart waits for its predecessor; the environment this process started with is kept for the next.
await waitForPredecessor(process.env)
const startEnv = { ...process.env }
let restartCode: number | undefined

let instance: TheoClawInstance
let imported: AgentImport | undefined
let telemetry: RegisteredTelemetry
try {
  // The arguments first: a scheduled task passes its configuration as arguments, not as environment.
  const parsed = parseEntryArguments(process.argv.slice(2), process.env)
  if (!parsed.ok) {
    process.stderr.write(`theoclaw: ${parsed.error}\n`)
    process.exit(2)
  }
  // The configuration file next (B-374): it fills only what the environment leaves unset.
  const configFile = loadConfiguration(process.env, homedir())
  // B-718: mirror the output to THEOCLAW_LOG_FILE, which `theoclaw logs` reads where there is no user unit.
  applyProxyEnvironment(process.env)
  teeToLogFile(process.env, [process.stdout, process.stderr])
  // Hot reload (B-399): a change to the model settings applies to the next agent, without a restart.
  // A changed start-only setting (port, token, channel, policy) restarts the process (B-716).
  if (configFile !== undefined) {
    watchConfiguration(configFile, process.env, {
      write: (line) => process.stderr.write(`${line}\n`),
      restart: () => {
        // Under a supervisor the exit alone is the restart; otherwise this process starts its own successor.
        if (supervised(process.env, process.platform)) restartCode = RESTART_EXIT_CODE
        else if (!spawnSuccessor(startEnv)) return process.stderr.write('config: cannot restart; the change needs a restart by the owner\n')
        process.kill(process.pid, 'SIGTERM')
      },
    })
  }
  instance = resolveInstance(process.env, { homeDir: homedir() })
  // The instance lock before `applyInstance` creates the targets (B-400 FR-010): a start refused
  // while a backup or a restore runs leaves both as they were. Released when the process exits.
  const release = claimInstance(instance, process.env)
  if (release !== undefined) process.once('exit', release)
  // After the instance, so a profile's own state directory is the one read (FR-010, FR-011).
  const mcp = requireImportedMcp(process.env)
  const setup = readImportAtStart(process.env, (line) => process.stderr.write(`${line}\n`))
  imported = setup === undefined ? undefined : { setup, mcp }
  // Before any agent exists, so every agent records through the providers (B-400 FR-006).
  telemetry = await registerTelemetry(readTelemetrySettings(process.env), { write: (line) => process.stderr.write(`${line}\n`) })
} catch (error) {
  fail(error)
}
// Best effort: the kernel keeps the title within the original command line's length.
process.title = instance.label

const workspace = instance.workspace
const createSdkAgent = (options: TheoClawAgentOptions): Promise<SDKAgent> =>
  Agent.create({ ...options, local: { ...options.local, ...(workspace === undefined ? {} : { cwd: workspace }) } })
const create: CreateAgent = createSdkAgent

// Secret references become their values in the process environment, so the agent factories that read it
// see them too; `startTheoClaw` masks the same values (B-711).
const secretRefs = await resolveSecretRefs(process.env).catch((error: unknown) => fail(error))
Object.assign(process.env, secretRefs.env)

startTheoClaw({
  env: process.env,
  importedSecrets: [...importedMcpSecrets(imported), ...secretRefs.values],
  telemetryLog: (line) => telemetry.log(line),
  instance,
  // The import reaches the `/control` agents only; WebChat's, the workers' and the chat path's factories take none (FR-009).
  agentFactory: createAgentFactory(process.env, create, imported),
  importFreeAgentFactory: createAgentFactory(process.env, create),
  importedPaths: importedMcpPaths(imported),
  ...(imported === undefined ? {} : { importedLine: importedSetupLine(imported.setup, imported.mcp) }),
  // WebChat's agents: created like the /control ones, from the chat path's options (no tool, B-382).
  createChatAgent: create,
  // The `digest` tool's draft agents (B-387): the chat path's factory, so no tool, no shell, memory off.
  draftAgentFactory: createChannelAgentFactory(process.env, createSdkAgent),
  // The `triage` workflow's JSON-only step (B-679): shell withheld, memory off.
  generateObject: createObjectGenerator(process.env, workspace),
  // A trigger run's agent (B-397): the chat path's factory too, a fresh one per run, in the workspace.
  triggerAgentFactory: createChannelAgentFactory(process.env, createSdkAgent),
  signals: process,
  // What is pending is exported first, for at most the bound, so a down collector cannot hold the exit.
  exit: (code) =>
    void Promise.race([telemetry.shutdown(), new Promise((resolve) => setTimeout(resolve, TELEMETRY_SHUTDOWN_MS).unref())]).finally(() =>
      process.exit(restartCode ?? code),
    ),
}).catch(fail)
