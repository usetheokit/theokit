import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as config from '../../src/config-entry.js'
import { defineLayeredConfig } from '../../src/config/define-layered-config.js'
import { envKnob } from '../../src/config/env-knobs.js'

const MODES = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS = ['untrusted', 'on-request', 'never']
const floor = (permissiveness: string[]) => ({
  permissiveness,
  restricted: ['project', 'project_local', 'profile', 'env'],
  override: 'cli',
})

const schema = z.object({
  model: z.string().default('m/default'),
  sandbox_mode: z
    .enum(['read-only', 'workspace-write', 'danger-full-access'])
    .default('workspace-write'),
  approval_policy: z.enum(['untrusted', 'on-request', 'never']).default('on-request'),
  hooks: z.array(z.string()).default([]),
  profile: z.string().optional(),
  profiles: z.record(z.string(), z.object({ model: z.string().optional() })).optional(),
})

const cfg = defineLayeredConfig({
  schema,
  defaults: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' },
  env: { sandbox_mode: envKnob('APP_SANDBOX', 'string') },
  accumulate: ['hooks'],
  floors: { sandbox_mode: floor(MODES), approval_policy: floor(APPROVALS) },
  profiles: { selectKey: 'profile', tableKey: 'profiles' },
})

describe('defineLayeredConfig', () => {
  it("a managed sandbox value wins over the user's looser value", () => {
    const r = cfg.resolve({
      user: { sandbox_mode: 'danger-full-access', approval_policy: 'never' },
      managed: { sandbox_mode: 'read-only', approval_policy: 'untrusted', model: 'm/x' },
    })
    expect(r.values.sandbox_mode).toBe('read-only')
    expect(r.values.approval_policy).toBe('untrusted')
    expect(r.values.model).toBe('m/x')
  })

  it('a project layer cannot loosen a floored key and the cli layer can', () => {
    const user = { sandbox_mode: 'read-only' }
    const project = { sandbox_mode: 'danger-full-access' }
    expect(cfg.resolve({ user, project }).values.sandbox_mode).toBe('read-only')
    expect(
      cfg.resolve({ user, project, cli: { sandbox_mode: 'danger-full-access' } }).values
        .sandbox_mode,
    ).toBe('danger-full-access')
  })

  it('an env value can tighten a floored key and cannot loosen it', () => {
    expect(cfg.resolve({ env: { APP_SANDBOX: 'read-only' } }).values.sandbox_mode).toBe('read-only')
    expect(
      cfg.resolve({
        user: { sandbox_mode: 'read-only' },
        env: { APP_SANDBOX: 'danger-full-access' },
      }).values.sandbox_mode,
    ).toBe('read-only')
  })

  it('profiles merge per name across user and project', () => {
    const r = cfg.resolve({
      user: { profiles: { a: { model: 'm/a' }, b: { model: 'm/b' } }, profile: 'b' },
      project: { profiles: { a: { model: 'm/a2' } } },
    })
    expect(r.profile).toBe('b')
    expect(r.values.model).toBe('m/b')
    expect(
      cfg.resolve({
        user: { profiles: { a: { model: 'm/a' }, b: { model: 'm/b' } } },
        project: { profiles: { a: { model: 'm/a2' } } },
        cli: { profile: 'a' },
      }).values.model,
    ).toBe('m/a2')
  })

  it('an unknown selected profile throws naming the profile', () => {
    expect(() => cfg.resolve({ user: { profile: 'ghost' } })).toThrow(/ghost/)
  })

  it('accumulate keys concatenate across layers', () => {
    const r = cfg.resolve({ user: { hooks: ['a'] }, project: { hooks: ['b'] } })
    expect(r.values.hooks).toEqual(['a', 'b'])
  })

  it('a schema error names the layer it came from', () => {
    expect(() => cfg.resolve({ project: { sandbox_mode: 'bogus' } })).toThrow(/"project"/)
  })

  it('provenancePerKey names managed for a managed key', () => {
    const r = cfg.resolve({
      user: { sandbox_mode: 'danger-full-access', model: 'm/u' },
      managed: { sandbox_mode: 'read-only' },
    })
    expect(r.provenancePerKey.sandbox_mode).toBe('managed')
    expect(r.provenancePerKey.model).toBe('user')
  })

  it('is exported from the config subpath', () => {
    expect(config.defineLayeredConfig).toBe(defineLayeredConfig)
  })
})
