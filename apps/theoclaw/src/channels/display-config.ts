import type { PlatformName } from '@theokit/gateway'

import { TheoClawConfigError } from '../control-plane/errors.js'

/**
 * Per-platform display resolver (B-370, PIECE-1; after Hermes `gateway/display_config.py`).
 * One property picks the tier: whether the platform can edit a message it already sent.
 * Lookup order: `platforms[platform][key]` -> `global[key]` -> platform default -> tier default.
 */
export type DisplayTier = 'high' | 'medium' | 'low' | 'minimal'
export type ToolProgress = 'all' | 'new' | 'off'
export type LiveStatus = 'full' | 'verb' | 'off'
export type ReasoningStyle = 'subtext' | 'plain'

export interface DisplaySettings {
  readonly tool_progress: ToolProgress
  readonly live_status: LiveStatus
  /** Delete progress bubbles after a successful reply; failed runs keep them. */
  readonly cleanup_progress: boolean
  readonly show_reasoning: boolean
  readonly reasoning_style: ReasoningStyle
  readonly streaming: boolean
  readonly tool_preview_length: number
}

export type DisplayOverrides = Partial<DisplaySettings>

export interface DisplayConfig {
  readonly global?: DisplayOverrides
  readonly platforms?: Readonly<Partial<Record<PlatformName, DisplayOverrides>>>
}

const TIER_DEFAULTS: Readonly<Record<DisplayTier, DisplaySettings>> = {
  high: { tool_progress: 'all', live_status: 'full', cleanup_progress: true, show_reasoning: false, reasoning_style: 'plain', streaming: true, tool_preview_length: 40 },
  medium: { tool_progress: 'new', live_status: 'verb', cleanup_progress: true, show_reasoning: false, reasoning_style: 'plain', streaming: true, tool_preview_length: 40 },
  low: { tool_progress: 'off', live_status: 'off', cleanup_progress: false, show_reasoning: false, reasoning_style: 'plain', streaming: false, tool_preview_length: 0 },
  minimal: { tool_progress: 'off', live_status: 'off', cleanup_progress: false, show_reasoning: false, reasoning_style: 'plain', streaming: false, tool_preview_length: 0 },
}

/** Tier of each platform. LINE and Teams are not in Hermes' table: chosen by whether they edit. */
const PLATFORM_TIERS: Readonly<Record<string, DisplayTier>> = {
  discord: 'high',
  telegram: 'high',
  slack: 'medium',
  matrix: 'medium',
  mattermost: 'medium',
  teams: 'medium',
  google_chat: 'low',
  tlon_urbit: 'low',
  whatsapp: 'low',
  line: 'low',
  email: 'minimal',
  sms: 'minimal',
}

/** Platform defaults that differ from the tier's. */
const PLATFORM_DEFAULTS: Readonly<Record<string, DisplayOverrides>> = {
  discord: { reasoning_style: 'subtext' },
  // Mobile inbox: quiet tool progress.
  telegram: { tool_progress: 'off' },
  // Bolt posts cannot be edited; 'new'/'all' would leave permanent lines.
  slack: { tool_progress: 'off' },
}

/** An unknown platform is treated as the most conservative tier. */
export function tierOf(platform: PlatformName | string): DisplayTier {
  return PLATFORM_TIERS[platform] ?? 'minimal'
}

export function resolveDisplay(platform: PlatformName | string, config: DisplayConfig = {}): DisplaySettings {
  return {
    ...TIER_DEFAULTS[tierOf(platform)],
    ...PLATFORM_DEFAULTS[platform],
    ...config.global,
    ...config.platforms?.[platform as PlatformName],
  }
}

type Env = Readonly<Record<string, string | undefined>>

const OVERRIDE_KEYS = ['TOOL_PROGRESS', 'LIVE_STATUS', 'CLEANUP_PROGRESS', 'SHOW_REASONING'] as const

function overrideFrom(env: Env, prefix: string): DisplayOverrides {
  const out: { -readonly [K in keyof DisplaySettings]?: DisplaySettings[K] } = {}
  for (const key of OVERRIDE_KEYS) {
    const variable = `${prefix}${key}`
    const raw = env[variable]?.trim().toLowerCase()
    if (raw === undefined || raw === '') continue
    const bad = (): never => {
      throw new TheoClawConfigError(`${variable}: unsupported value`, { variable })
    }
    if (key === 'TOOL_PROGRESS') out.tool_progress = raw === 'all' || raw === 'new' || raw === 'off' ? raw : bad()
    else if (key === 'LIVE_STATUS') out.live_status = raw === 'full' || raw === 'verb' || raw === 'off' ? raw : bad()
    else {
      const flag = raw === 'true' || raw === 'on' ? true : raw === 'false' || raw === 'off' ? false : bad()
      if (key === 'CLEANUP_PROGRESS') out.cleanup_progress = flag
      else out.show_reasoning = flag
    }
  }
  return out
}

/**
 * Overrides from the environment: `THEOCLAW_DISPLAY_<KEY>` for every platform and
 * `THEOCLAW_DISPLAY_<PLATFORM>_<KEY>` for one, with KEY one of TOOL_PROGRESS (all|new|off),
 * LIVE_STATUS (full|verb|off), CLEANUP_PROGRESS and SHOW_REASONING (true|false). A bad value throws
 * `TheoClawConfigError` naming the variable. Only known platforms are read, so a variable for a
 * misspelled platform changes nothing.
 */
export function readDisplayConfig(env: Env): DisplayConfig {
  const platforms: Partial<Record<PlatformName, DisplayOverrides>> = {}
  for (const platform of Object.keys(PLATFORM_TIERS)) {
    const overrides = overrideFrom(env, `THEOCLAW_DISPLAY_${platform.toUpperCase()}_`)
    if (Object.keys(overrides).length > 0) platforms[platform as PlatformName] = overrides
  }
  return { global: overrideFrom(env, 'THEOCLAW_DISPLAY_'), platforms }
}
