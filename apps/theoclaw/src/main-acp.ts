import './runtime.js'
import 'reflect-metadata'

import { homedir } from 'node:os'

import { serveAcp } from '@theokit/acp'
import { Agent } from '@theokit/sdk'
import type { SDKAgent } from '@theokit/sdk'

import type { TheoClawAgentOptions } from './agent/create-agent.js'
import { loadConfiguration } from './config-file.js'
import { createAgentFactory } from './control-plane/agent-factory.js'
import type { CreateAgent } from './control-plane/agent-factory.js'
import { describeError } from './control-plane/errors.js'
import { parseEntryArguments } from './entry-arguments.js'
import { applyInstance, resolveInstance } from './instance.js'
import { resolveSecretRefs } from './secret-refs.js'

/**
 * `theoclaw acp` (OC-68): the `/control` agent served over the Agent Client Protocol on stdin/stdout, so an ACP
 * host such as Zed drives it. Stdout carries the protocol, so every diagnostic goes to stderr. Each ACP session
 * gets its own agent from the same factory as a `/control` turn, with the model key passed explicitly; tool calls
 * round-trip through the host's permission prompt (`ask`).
 */
function fail(error: unknown): never {
  process.stderr.write(`theoclaw: ${describeError(error)}\n`)
  process.exit(1)
}

try {
  const parsed = parseEntryArguments(process.argv.slice(2), process.env)
  if (!parsed.ok) {
    process.stderr.write(`theoclaw: ${parsed.error}\n`)
    process.exit(2)
  }
  loadConfiguration(process.env, homedir())
  const instance = resolveInstance(process.env, { homeDir: homedir() })
  applyInstance(instance, process.env)
  const secretRefs = await resolveSecretRefs(process.env)
  Object.assign(process.env, secretRefs.env)
  const workspace = instance.workspace
  const createSdkAgent = (options: TheoClawAgentOptions): Promise<SDKAgent> => Agent.create({ ...options, local: { ...options.local, ...(workspace === undefined ? {} : { cwd: workspace }) } })
  const create: CreateAgent = createSdkAgent
  const factory = createAgentFactory(process.env, create)
  await serveAcp({
    agent: async () => (await factory()) as unknown as SDKAgent,
    info: { name: 'theoclaw', title: 'TheoClaw', version: '0.1.0' },
    permissionDefault: 'ask',
    log: (line) => process.stderr.write(`${line}\n`),
  })
} catch (error) {
  fail(error)
}
