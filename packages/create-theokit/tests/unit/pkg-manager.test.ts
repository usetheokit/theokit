import { describe, it, expect, afterEach } from 'vitest'

import { detectPkgManager } from '../../src/pkg-manager.js'

describe('detectPkgManager', () => {
  const originalEnv = process.env.npm_config_user_agent

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.npm_config_user_agent
    } else {
      process.env.npm_config_user_agent = originalEnv
    }
  })

  it('should detect npm when user agent is empty', () => {
    process.env.npm_config_user_agent = ''
    expect(detectPkgManager()).toBe('npm')
  })

  it('should detect npm when user agent is undefined', () => {
    delete process.env.npm_config_user_agent
    expect(detectPkgManager()).toBe('npm')
  })

  it('should detect yarn from user agent', () => {
    process.env.npm_config_user_agent = 'yarn/4.0.0 npm/? node/v22.12.0'
    expect(detectPkgManager()).toBe('yarn')
  })

  it('should detect pnpm from user agent', () => {
    process.env.npm_config_user_agent = 'pnpm/9.0.0 npm/? node/v22.12.0'
    expect(detectPkgManager()).toBe('pnpm')
  })

  it('should detect bun from user agent', () => {
    process.env.npm_config_user_agent = 'bun/1.0.0 npm/? node/v22.12.0'
    expect(detectPkgManager()).toBe('bun')
  })

  it('should fallback to npm for unknown user agents', () => {
    process.env.npm_config_user_agent = 'unknown-manager/1.0.0'
    expect(detectPkgManager()).toBe('npm')
  })
})
