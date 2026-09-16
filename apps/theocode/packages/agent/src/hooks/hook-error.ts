import { TheokitAgentError } from '@theokit/agents'

export class HookError extends TheokitAgentError {
  override readonly name = 'HookError'

  constructor(message: string) {
    super(message)
  }
}
