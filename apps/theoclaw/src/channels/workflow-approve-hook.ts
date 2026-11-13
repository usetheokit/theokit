import type { GatewayHook } from '@theokit/gateway'

const MENTION = '(?:(?:<@[^>]+>|@\\S+)\\s+)?'
const COMMAND = new RegExp(`^${MENTION}/(approve|deny)(?:@\\S+)?\\s+(wfr-[A-Za-z0-9_-]+)$`)

export interface WorkflowApproveOptions {
  readonly isOwner: (platform: string, senderId: string) => boolean
  /** Resumes the run a token names; undefined when no workflow knows it. */
  readonly resume: (token: string, approved: boolean) => Promise<string | undefined>
}

/** `/approve <token>` and `/deny <token>`: resume a suspended user workflow run, owners only; never reaches the model. */
export function createWorkflowApproveHook(options: WorkflowApproveOptions): GatewayHook {
  return {
    name: 'theoclaw-workflow-approve',
    async pre_inbound({ event }) {
      const match = COMMAND.exec(event.text.trim())
      if (match === null) return undefined
      if (!options.isOwner(event.platform, event.sender.id)) return { block: true, message: 'Only an owner can do that.' }
      const outcome = await options.resume(match[2]!, match[1] === 'approve').catch(() => undefined)
      return { block: true, message: outcome ?? 'No suspended workflow run has that token.' }
    },
  }
}
