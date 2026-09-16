import {
  CONTEXT_WINDOW_FLOOR,
  CONTEXT_WINDOW_MARGIN,
  type EffectiveContextWindow,
  resolveEffectiveContextWindow,
} from '@theokit/agents'

export const AGENT = {
  name: 'TheoCode',
  /**
   * The version the product SHOWS. Both references this repository measures itself against put it
   * on screen — Codex in its header (`>_ OpenAI Codex (v0.147.0)`), Claude Code in the top border
   * (`╭─── Claude Code v2.1.236 ───`) — and TheoCode showed it nowhere, so a user could not say
   * which build they were running without leaving the TUI.
   *
   * A literal rather than an import of the root `package.json`: `packages/shared` cannot import
   * across its own package boundary without breaking the bundle, and `agent.test.ts` already exists
   * to keep this object honest. The test there READS the root manifest and fails when the two
   * disagree, which is the same guarantee an import would give and the same shape B-002 used for
   * the name.
   */
  version: '0.27.0',
  model: 'gpt-5.6-terra',
  greeting:
    "Hi — I'm TheoCode, a Codex-style coding agent on @theokit/agents. Ask me anything and I'll stream a reply.",
} as const

export function modelContextWindow(opts: {
  catalogWindow?: number
  override?: number
}): EffectiveContextWindow {
  return resolveEffectiveContextWindow({
    ...(opts.catalogWindow !== undefined ? { catalog: opts.catalogWindow } : {}),
    ...(opts.override !== undefined ? { override: opts.override } : {}),
    margin: CONTEXT_WINDOW_MARGIN,
    floor: CONTEXT_WINDOW_FLOOR,
  })
}
