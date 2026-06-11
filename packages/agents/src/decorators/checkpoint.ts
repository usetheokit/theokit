/**
 * @Checkpoint() — enables resumable agent execution from the last successful step.
 *
 * Long-running agents (research, code review, multi-step workflows) can fail
 * partway through. Without checkpointing, users restart from step 1 — wasting
 * tokens, time, and cost.
 *
 * Inspired by tRPC's tracked() + lastEventId pattern and Dapr's actor state
 * checkpointing. The agent persists a recovery point after each successful
 * tool call or iteration, and can resume from that point on retry.
 *
 * @example
 * ```ts
 * @Agent({ name: 'research', route: '/research' })
 * @Checkpoint({
 *   storage: 'drizzle',
 *   strategy: 'after-tool-call',
 *   maxCheckpoints: 20,
 *   ttl: 3_600_000,  // 1h
 * })
 * class ResearchAgent {
 *   @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 15 })
 *   async run() {}
 * }
 *
 * // Resume from checkpoint:
 * // POST /agents/research/chat { resumeToken: 'chk_abc123' }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const CHECKPOINT_CONFIG = Symbol.for('theokit:agents:checkpoint')

export type CheckpointStrategy =
  | 'after-tool-call'    // checkpoint after every successful tool execution
  | 'after-iteration'    // checkpoint after every loop iteration
  | 'manual'             // only checkpoint when explicitly called via ctx.checkpoint()

export type CheckpointStorage = 'memory' | 'filesystem' | 'drizzle' | 'redis'

export interface CheckpointOptions {
  /** Where to persist checkpoints. */
  storage?: CheckpointStorage
  /** When to auto-checkpoint (default: 'after-tool-call'). */
  strategy?: CheckpointStrategy
  /** Maximum checkpoints to retain per run (rolling window). */
  maxCheckpoints?: number
  /** Time-to-live in ms before checkpoints expire (default: 3_600_000 = 1h). */
  ttl?: number
}

/** Serializable checkpoint state. */
export interface CheckpointState {
  id: string
  runId: string
  agentName: string
  step: number
  messages: unknown[]
  toolResults: unknown[]
  createdAt: number
  resumeToken: string
}

export function Checkpoint(options: CheckpointOptions = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(CHECKPOINT_CONFIG, target, {
      storage: 'memory',
      strategy: 'after-tool-call',
      maxCheckpoints: 10,
      ttl: 3_600_000,
      ...options,
    })
  }
}

export function getCheckpointConfig(target: Function): CheckpointOptions | undefined {
  return getMeta<CheckpointOptions>(CHECKPOINT_CONFIG, target)
}
