import { describe, it, expect } from 'vitest'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Bundle size regression', () => {
  const distDir = resolve(__dirname, '../../dist')

  it('http-decorators main bundle under 30KB', () => {
    const size = statSync(resolve(distDir, 'index.js')).size
    expect(size).toBeLessThan(30_000)
    console.log(`  http-decorators/dist/index.js: ${(size / 1024).toFixed(1)} KB`)
  })

  it('http-decorators DTS under budget', () => {
    const size = statSync(resolve(distDir, 'index.d.ts')).size
    // Budget bumped 48KB → 52KB (#122): the public surface gained
    // `transformControllerSource` + `SwcCore` so the framework's Vite
    // controller transform can reuse the swc option block (ADR-1 / Rule 9),
    // instead of duplicating it (G12). Deliberate, minimal API addition.
    // Budget bumped 52KB → 56KB (M47): the surface gained the `@Expose`
    // decorator + `ExposeOptions`/`ExposeEntry` + the `WalkResult.agent`
    // field + `ServeAgent` + `@UseGuards` widened to a PropertyDecorator, so
    // an agent binds to a controller visibly (ADR-0059). Deliberate addition.
    // Budget bumped 56KB → 58KB (#574): the surface gained `@Public()` +
    // `PUBLIC_ROUTE_METADATA`, so a controller says its access decision as
    // intent instead of copying the framework's metadata key into app source
    // as a string literal. Measured cost 673 bytes, of which the docblock's
    // usage example is most — trimmed to what a hover needs and kept, because
    // an access decision nobody can read from the editor is the thing this
    // export exists to fix. The baseline was already 55 482, so the headroom
    // was 518 before this: the bump is the honest number, not a round one.
    expect(size).toBeLessThan(58_000)
    console.log(`  http-decorators/dist/index.d.ts: ${(size / 1024).toFixed(1)} KB`)
  })
})
