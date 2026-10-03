/**
 * The services.json v1 warning is for the target that reads services.json, and it names no
 * deadline that has already passed.
 *
 * Measured on 2026-10-02 against a `create-theokit@3.0.13` scaffold built for `bun`: the build
 * printed "services.json emitted as v1 ... sunset in theokit 0.6.0" on `theokit@0.74.2`. The
 * warning fired on every target, for an app that declares no services, about a file only the
 * `theo-cloud` target reads, and it promised a removal 68 minor versions in the past.
 */
import { describe, expect, it } from 'vitest'

import { describeServicesManifest } from '../../packages/theo/src/cli/commands/build/describe-services-manifest.js'
import { buildManifest } from '../../packages/theo/src/services/index.js'
import type { ServicesConfig } from '../../packages/theo/src/services/index.js'

const withoutServicesV1 = buildManifest({})

describe('describeServicesManifest', () => {
  it('stays silent about a v1 manifest on a target that never reads it', () => {
    expect(describeServicesManifest(withoutServicesV1, 'bun')).toBeNull()
  })

  it('warns the theo-cloud target, which reads services.json', () => {
    expect(describeServicesManifest(withoutServicesV1, 'theo-cloud')).toContain(
      'theokit migrate services-json-v1-to-v2',
    )
  })

  it('names no sunset version in the warning', () => {
    expect(describeServicesManifest(withoutServicesV1, 'theo-cloud')).not.toMatch(/sunset/i)
  })

  it('still reports the services a project declares, on any target', () => {
    const services: ServicesConfig = {
      api: {
        runtime: 'node',
        port: 8002,
        proxy: '/api/worker',
        dev: 'tsx watch src/index.ts',
        start: 'node dist/index.js',
        healthcheck: '/health',
        cors: false,
        passSetCookie: false,
      },
    }
    const manifest = buildManifest(services, 'shop')

    expect(describeServicesManifest(manifest, 'node')).toContain('1 service(s) (api)')
  })
})
