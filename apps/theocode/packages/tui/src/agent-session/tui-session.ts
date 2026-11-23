import { tmpdir } from 'node:os'

import { fallbackConfigPosture } from '../config-health.js'
import { randomUUID } from 'node:crypto'

import { resolveEffectiveConfig, type ReasoningEffort } from '@theocode/agent/config'
import type { AttachedImage } from '@theocode/agent/context'

import { loadOrCreateSessionId, persistSessionId } from '../persistence/index.js'
import { workingDirectory } from '../working-directory.js'

export interface TuiSession {
  cfg: () => ReturnType<typeof resolveEffectiveConfig>
  reloadConfig: () => void

  effort: () => ReasoningEffort
  setEffort: (e: ReasoningEffort) => void

  /** True when this launch took its session from a stored pointer rather than minting one. */
  readonly resumed: boolean

  session: () => string
  setSession: (id: string) => void

  takeImages: () => AttachedImage[] | undefined
  attachImages: (imgs: AttachedImage[] | undefined) => void

  takeModel: () => string | undefined
  setModel: (m: string | undefined) => void

  sessionModel: () => string | undefined
  setSessionModel: (m: string | undefined) => void
}

export interface SessionOptions {
  readonly cwd?: string
  /** Transcript root the framework pointer lives under; the framework default when absent. */
  readonly pointerRoot?: string
  /**
   * Whether to READ the pointer. It is written either way, so a later `--continue` can find the
   * session; reading it is what makes this launch inherit the previous conversation.
   */
  readonly resume?: boolean
  readonly loadSession?: (
    cwd: string,
    fresh: () => string,
    root?: string,
  ) => { readonly sessionId: string; readonly resumed: boolean }
  readonly loadConfig?: typeof resolveEffectiveConfig
}

/** The initial config load: a file that cannot be read yields the confined posture (#827). */
function loadConfigOrConfined(
  loadConfig: typeof resolveEffectiveConfig,
  cwd: string,
): ReturnType<typeof resolveEffectiveConfig> {
  try {
    return loadConfig({ cwd })
  } catch {
    // Through the `cli` layer, in its `key=value` form: that is the layer `security-floor.ts`
    // designates as the operator's override, and this only ever HARDENS.
    const posture = Object.entries(fallbackConfigPosture()).map(([k, v]) => `${k}=${v}`)
    return loadConfig({ cwd: tmpdir(), cli: posture })
  }
}

export function createTuiSession(opts: SessionOptions): TuiSession {
  const loadConfig = opts.loadConfig ?? resolveEffectiveConfig
  const loadSession = opts.loadSession ?? loadOrCreateSessionId
  const cwd = opts.cwd ?? workingDirectory()

  // #827 — a typo in `settings.json` must not take the terminal down.
  //
  // `resolveEffectiveConfig` throws `ConfigError` on a malformed file, and this call had no guard:
  // once a directory is trusted its project config IS read, so a broken file killed the process
  // with a stack trace before the first frame. Measured 2026-09-17 and confirmed pre-existing by
  // rebuilding HEAD. `session-start.ts` already makes this argument for its own path — "a hook
  // failing must not refuse a session the operator just asked for" — and this is the path it does
  // not cover.
  //
  // The fallback is the CONFINED posture, not the defaults: the operator expressed a preference
  // that could not be read, and granting write authority on the strength of a file we just failed
  // to parse is the opposite of what the failure warrants. `configHealthNotice` puts the reason on
  // screen so the narrow posture is explained rather than mysterious.
  let cfg = loadConfigOrConfined(loadConfig, cwd)
  let effort: ReasoningEffort = cfg.reasoning_effort
  // READING the pointer is what makes this launch inherit a conversation; WRITING it is what makes
  // the NEXT launch able to. Only the first is gated by `resume`.
  //
  // The pointer used to be written as a side effect of `loadOrCreateSessionId`, which generates and
  // persists when the file is absent. Making resume opt-in bypassed that function on the default
  // path, and nothing wrote the pointer any more: `--continue` had nothing to find unless the user
  // had first typed `/new`, the only other writer. Measured in a clean workspace after a full
  // session — a turn, a delegation, a custom command — and the file was not there.
  const freshSession = () => `tui-${randomUUID()}`
  let session: string
  let resumed = false
  if (opts.resume === true) {
    const loaded = loadSession(cwd, freshSession, opts.pointerRoot)
    session = loaded.sessionId
    resumed = loaded.resumed
  } else {
    session = freshSession()
    void persistSessionId(cwd, session, undefined, opts.pointerRoot)
  }
  let images: AttachedImage[] | undefined
  let model: string | undefined
  let fixedModel: string | undefined

  return {
    resumed,
    cfg: () => cfg,
    reloadConfig: () => {
      cfg = loadConfig({ cwd })
      effort = cfg.reasoning_effort
    },
    effort: () => effort,
    setEffort: (e) => {
      effort = e
    },
    session: () => session,
    setSession: (id) => {
      session = id
    },
    takeImages: () => {
      const current = images
      images = undefined
      return current
    },
    attachImages: (imgs) => {
      images = imgs
    },
    takeModel: () => {
      const current = model
      model = undefined
      return current ?? fixedModel
    },
    sessionModel: () => fixedModel,
    setSessionModel: (m) => {
      fixedModel = m
    },
    setModel: (m) => {
      model = m
    },
  }
}
