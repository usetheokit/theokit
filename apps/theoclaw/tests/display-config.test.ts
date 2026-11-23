import { describe, expect, it } from 'vitest'

import { readDisplayConfig, resolveDisplay, tierOf } from '../src/channels/display-config.js'

describe('display resolver', () => {
  it('ships tool progress off on Telegram and Slack', () => {
    expect(resolveDisplay('telegram').tool_progress).toBe('off')
    expect(resolveDisplay('slack').tool_progress).toBe('off')
  })

  it('maps platforms onto the four tiers', () => {
    expect(tierOf('discord')).toBe('high')
    expect(tierOf('telegram')).toBe('high')
    expect(tierOf('slack')).toBe('medium')
    expect(tierOf('whatsapp')).toBe('low')
    expect(tierOf('sms')).toBe('minimal')
    expect(tierOf('unknown')).toBe('minimal')
  })

  it('resolves each key from the tier', () => {
    expect(resolveDisplay('discord')).toMatchObject({ tool_progress: 'all', live_status: 'full', cleanup_progress: true, reasoning_style: 'subtext' })
    expect(resolveDisplay('matrix')).toMatchObject({ tool_progress: 'new', live_status: 'verb' })
    expect(resolveDisplay('whatsapp')).toMatchObject({ tool_progress: 'off', live_status: 'off', cleanup_progress: false, streaming: false })
    expect(resolveDisplay('email')).toMatchObject({ tool_progress: 'off', tool_preview_length: 0 })
  })

  it('shows no reasoning anywhere by default', () => {
    for (const p of ['discord', 'telegram', 'slack', 'matrix', 'whatsapp', 'email', 'sms', 'line', 'teams', 'mattermost']) {
      expect(resolveDisplay(p).show_reasoning).toBe(false)
    }
  })

  it('prefers platform override, then global, then defaults', () => {
    const config = { global: { tool_progress: 'new', live_status: 'verb' }, platforms: { telegram: { tool_progress: 'all' } } } as const
    expect(resolveDisplay('telegram', config).tool_progress).toBe('all')
    expect(resolveDisplay('slack', config).tool_progress).toBe('new')
    expect(resolveDisplay('telegram', config).live_status).toBe('verb')
    expect(resolveDisplay('telegram', {}).tool_progress).toBe('off')
  })

  it('lets a global override beat a platform default', () => {
    expect(resolveDisplay('telegram', { global: { tool_progress: 'new' } }).tool_progress).toBe('new')
  })

  it('reads overrides from the environment and refuses a bad value', () => {
    const config = readDisplayConfig({
      THEOCLAW_DISPLAY_LIVE_STATUS: 'verb',
      THEOCLAW_DISPLAY_TELEGRAM_TOOL_PROGRESS: 'all',
      THEOCLAW_DISPLAY_SLACK_SHOW_REASONING: 'true',
    })
    expect(resolveDisplay('telegram', config)).toMatchObject({ tool_progress: 'all', live_status: 'verb' })
    expect(resolveDisplay('slack', config)).toMatchObject({ tool_progress: 'off', show_reasoning: true })
    expect(() => readDisplayConfig({ THEOCLAW_DISPLAY_TOOL_PROGRESS: 'loud' })).toThrow(/THEOCLAW_DISPLAY_TOOL_PROGRESS/)
  })
})
