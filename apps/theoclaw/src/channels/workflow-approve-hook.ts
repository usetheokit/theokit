import { parseChatCommand } from '@theokit/gateway'
import type { GatewayHook } from '@theokit/gateway'

const TOKEN = /^wfr-[A-Za-z0-9_-]+$/

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
      const command = parseChatCommand(event.text)
      if ((command?.name !== 'approve' && command?.name !== 'deny') || !TOKEN.test(command.arg)) return undefined
      if (!options.isOwner(event.platform, event.sender.id)) return { block: true, message: 'Only an owner can do that.' }
      try {
        const outcome = await options.resume(command.arg, command.name === 'approve')
        return { block: true, message: outcome ?? 'No suspended workflow run has that token.' }
      } catch (error) {
        return { block: true, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
