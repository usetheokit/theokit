import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTheoClawAgent, theoClawAgentOptions } from '../agent/create-agent.js'
import type { ThinkingLevel } from '../agent/failover.js'
import type { AgentImport, TheoClawAgentOptions, TheoClawLocalOptions } from '../agent/create-agent.js'
import { parseFallbackModel, parseThinkingLevel, withFailover } from '../agent/failover.js'
import { parseApprovedHooks } from '../agent/hook-approval.js'
import { readPersonaPrompt } from '../agent/persona-files.js'
import { agentTelemetry, readTelemetrySettings } from '../telemetry/otel.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'
import type { BindEnvironment } from './bind.js'
import { TheoClawConfigError } from './errors.js'
import { requireModel } from './settings.js'
import type { TurnAgent } from './turn.js'

/** The slice of `Agent.create` the factory calls; tests pass a fake. */
export type CreateAgent = (options: TheoClawAgentOptions) => Promise<TurnAgent>

/** A chat session's options: the protected set, plus where its transcripts live. */
export interface SessionAgentOptions extends TheoClawAgentOptions {
  readonly local: TheoClawLocalOptions & { readonly cwd: string; readonly sessionDir: string }
}

/** Whether `THEOCLAW_INCOGNITO=on`: chat turns keep no transcript under the workspace and reach no telemetry (OC-92). */
export function isIncognito(env: BindEnvironment): boolean {
  const value = env.THEOCLAW_INCOGNITO?.trim()
  if (value === undefined || value === '' || value === 'off') return false
  if (value === 'on') return true
  throw new TheoClawConfigError('THEOCLAW_INCOGNITO must be on or off', { variable: 'THEOCLAW_INCOGNITO' })
}

/**
 * The options every TheoClaw agent is built with, the model key passed explicitly (plan D4): the
 * SDK refuses `OPENROUTER_API_KEY` from the environment, so the key is resolved here by the same
 * `requireModel` the start checks.
 *
 * Whoever holds the control token, and every sender who reaches a chat agent (everyone under
 * `THEOCLAW_DM_POLICY=open`, B-371), writes the prompt, and a prompt can be steered, so the agent
 * is built without the SDK's `shell` builtin (no unsandboxed command runs on the host from a chat)
 * and with memory off (no memory transcript of the conversation lands under the cwd). These options
 * carry no tool: only a `/control` turn's agent gets the start's `agentToolOptions` (B-382),
 * through `createAgentFactory`. The SDK still records each agent in
 * `<cwd>/.theokit/agents/registry.json`; no option turns that off.
 */
export function agentOptionsFor(env: BindEnvironment): TheoClawAgentOptions {
  const { model, modelKey } = requireModel(env)
  return theoClawAgentOptions({ model, apiKey: modelKey, approvedHooks: parseApprovedHooks(env), ...thinkingOf(env), ...agentTelemetry(readTelemetrySettings(env)) })
}

/**
 * `options` with the transcript directory the SDK would otherwise default to `<home>/.theokit`: a
 * one-shot channel agent (a trigger run, a digest draft, a chat-completions turn) writes its
 * transcript under `<workspace>/.theoclaw` like a chat session, not into the operator's home, outside
 * the state the operator configured. Incognito sends it to a temp path instead. Absent a workspace
 * (a test), the options are returned as they were.
 */
export function withSessionHome(env: BindEnvironment, options: TheoClawAgentOptions): TheoClawAgentOptions {
  const workspace = env.THEOCLAW_WORKSPACE?.trim()
  if (workspace === undefined || workspace === '' || options.local.sessionDir !== undefined) return options
  const sessionDir = isIncognito(env) ? join(tmpdir(), `theoclaw-incognito-${randomUUID()}`) : join(workspace, '.theoclaw')
  return { ...options, local: { ...options.local, sessionDir } }
}

function thinkingOf(env: BindEnvironment): { thinking?: ThinkingLevel } {
  const thinking = parseThinkingLevel(env.THEOCLAW_THINKING)
  return thinking === undefined ? {} : { thinking }
}

/**
 * `create(options)` on the primary model; with `THEOCLAW_MODEL_FALLBACK` set, the agent falls over
 * to a secondary built lazily from the same options with the fallback model (OC-47). The fallback
 * runs on the same key; a secondary on another provider's key is not supported.
 */
function createWithFailover(env: BindEnvironment, create: CreateAgent, options: TheoClawAgentOptions): Promise<TurnAgent> {
  const fallback = parseFallbackModel(env.THEOCLAW_MODEL_FALLBACK)
  return create(options).then((primary) =>
    fallback === undefined || fallback === options.model ? primary : withFailover(primary, () => create({ ...options, model: fallback })),
  )
}

/**
 * A chat session's agent: the same protected options as a `/control` turn's, so the reply path
 * keeps the key, the withheld `shell` and memory off, plus its transcripts under
 * `<workspace>/.theoclaw` (plan D6), which is what lets a conversation survive a restart. Under a
 * profile, `workspace` is the profile's own, the directory its `/control` agents work in too.
 */
export function sessionAgentOptions(env: BindEnvironment, workspace: string): SessionAgentOptions {
  const incognito = isIncognito(env)
  const { telemetry, ...withoutTelemetry } = agentOptionsFor(env)
  const options: TheoClawAgentOptions = incognito || telemetry === undefined ? withoutTelemetry : { ...withoutTelemetry, telemetry }
  const persona = readPersonaPrompt(workspace)
  return {
    ...options,
    systemPrompt: persona === '' ? options.systemPrompt : `${options.systemPrompt}\n\n${persona}`,
    // Incognito: the transcript goes to a fresh path under the temp root, never the workspace, created by
    // the SDK only when it writes; the chat sessions remove it when the agent is disposed.
    local: { ...options.local, cwd: workspace, sessionDir: incognito ? join(tmpdir(), `theoclaw-incognito-${randomUUID()}`) : join(workspace, '.theoclaw') },
  }
}

/**
 * One agent per call, for the `/control` socket's turns (one request boundary each), with the
 * start's `agentToolOptions` (B-382): the published theokit tools bound to the tool root and the
 * sandbox, and the state-directory veto, plus a migration import when the start read one (FR-008).
 * The process entry and the live test both build their agents through this function, so the live
 * check proves the entry's own.
 */
export function createAgentFactory(
  env: BindEnvironment,
  create: CreateAgent = createTheoClawAgent,
  imported?: AgentImport,
): (toolOptions?: AgentToolOptions) => Promise<TurnAgent> {
  return async (toolOptions) => {
    const { model, modelKey } = requireModel(env)
    return createWithFailover(env, create, 
      theoClawAgentOptions({
        model,
        apiKey: modelKey,
        approvedHooks: parseApprovedHooks(env),
        ...thinkingOf(env),
        ...agentTelemetry(readTelemetrySettings(env)),
        ...(toolOptions === undefined ? {} : { toolOptions }),
        // Installed plugins reach only the owner's `/control` agent, never a chat agent (OC-75).
        ...(env.THEOCLAW_PLUGIN_WORKSPACE === undefined || env.THEOCLAW_PLUGIN_WORKSPACE === '' ? {} : { pluginWorkspace: env.THEOCLAW_PLUGIN_WORKSPACE }),
        ...(imported === undefined ? {} : { imported }),
      }),
    )
  }
}

/**
 * The agent of a chat reply. Whoever reaches the agent writes their prompt (everyone under
 * `THEOCLAW_DM_POLICY=open`, B-371), so a channel agent holds no tool and writes no memory: it is built from
 * `agentOptionsFor`, with no `shell` (`effectiveToolNames` reads an empty catalog) and memory off.
 * It is its own export, and every session agent is opened through it (`composition.ts`), so the
 * reply path keeps the withheld `shell` and memory off, pinned by its own test, even if the
 * `/control` turn's options change (sprint decision B-377 option A).
 */
export function createChannelAgentFactory<A>(
  env: BindEnvironment,
  create: (options: TheoClawAgentOptions) => Promise<A>,
): () => Promise<A> {
  return async () => create(agentOptionsFor(env))
}

/** The chat path's factory over the SDK, for a caller given no `create` of its own: a trigger run's default (B-397). */
export function createSdkChannelAgentFactory(env: BindEnvironment): () => Promise<TurnAgent> {
  return async () => createWithFailover(env, createTheoClawAgent, withSessionHome(env, agentOptionsFor(env)))
}

/**
 * A WebChat turn's agent: one per turn, through `createChannelAgentFactory`, so WebChat holds no
 * tool, no `shell` and memory off by the same export every chat agent is opened through, not by a
 * second "no tool" mechanism of its own. `create` defaults to the SDK's, as `createAgentFactory`'s.
 */
export function webchatAgentFactory(
  env: BindEnvironment,
  create: CreateAgent = createTheoClawAgent,
): () => Promise<TurnAgent> {
  return async () => createWithFailover(env, create, withSessionHome(env, agentOptionsFor(env)))
}
