/**
 * Every deploy target carries the CSRF mode the app declared (usetheokit/theokit#410).
 *
 * The six Web-standards entries built `executeRoute`'s context from an eight-field literal, and
 * `csrfMode` was not among the eight. `executeRoute` defaults an absent mode to `'strict'`, so an
 * app declaring `security: { csrf: 'off' }` got `'strict'` on every target: a POST that works
 * under `theokit dev` and `theokit start` answers `403 CSRF_INVALID` on Vercel, naming a mechanism
 * the operator had switched off. The config validated, the build succeeded, nothing warned.
 *
 * Asserted per target rather than once, because the defect WAS per target — six independent
 * literals that had each forgotten the same fields. A test covering one of them would have passed
 * on five broken adapters.
 */
import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

interface CsrfOpts {
  csrf?: 'off' | 'warn' | 'strict'
}

const ENTRIES: Record<string, (opts: CsrfOpts) => string> = {
  vercel: (o) => renderVercelFunctionEntry(o),
  netlify: (o) => renderNetlifyFunction(o),
  bun: (o) => renderBunEntry(3000, o),
  'deno-deploy': (o) => renderDenoEntry(3000, o),
  'aws-lambda': (o) => renderAwsLambdaEntry(o),
  cloudflare: (o) => renderCloudflareWorkerEntry({ ...o, ssrStreaming: false }),
}

describe.each(Object.entries(ENTRIES))('%s', (target, render) => {
  it("carries a declared csrf: 'off' into the emitted entry", () => {
    const source = render({ csrf: 'off' })

    expect(source, `${target} dropped the declared mode`).toContain(`csrfMode: "off"`)
  })

  it('spreads the config into the executeRoute call, not merely declares it', () => {
    // A const nothing reads is the same defect with a longer file. The spread is what puts the
    // value in the context `executeRoute` destructures.
    const source = render({ csrf: 'warn' })

    expect(source).toMatch(/executeRoute\(\{[^}]*\.\.\.CSRF_CONFIG/su)
  })

  it('emits no override when the app declared nothing, leaving the executor default', () => {
    const source = render({})

    expect(source).toContain('const CSRF_CONFIG = {}')
    expect(source).not.toContain('csrfMode:')
  })
})
