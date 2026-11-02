import { channelRendering } from '@theokit/gateway'
import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import { ChatPresenter } from '@theokit/presenter'

/**
 * Send `text` to `channelId` on `platform`, rendered for that platform's own dialect. Resolves
 * undefined once delivered, or why it was not: the platform's refusal code, or the thrown error's
 * name, never its message or an id. Shared by a broadcast group's fan-out and a trigger's reply.
 */
export async function deliverText(
  adapter: BasePlatformAdapter,
  platform: PlatformName,
  channelId: string,
  text: string,
): Promise<string | undefined> {
  const channel = { id: channelId, type: 'group' } as const
  const presenter = new ChatPresenter({ channel, ...channelRendering(platform) })
  presenter.present({ type: 'text', text })
  const [reply] = presenter.present({ type: 'finish', reason: 'end_turn' })
  try {
    const result = await adapter.sendMessage({
      channel,
      text: reply?.text ?? text,
      ...(reply?.format ? { format: reply.format } : {}),
    })
    return result.ok ? undefined : (result.error?.code ?? 'refused')
  } catch (error) {
    return error instanceof Error ? error.name : 'thrown'
  }
}
