/**
 * The generated `wrangler.toml` must let a dependency that resolves `__dirname` at load time survive.
 *
 * Cloudflare EXECUTES the top-level module during validation, so a bare
 * `dirname(fileURLToPath(import.meta.url))` at module scope refuses the whole upload — `import.meta.url`
 * is `undefined` there. Measured 2026-09-28 (B-320): every Cloudflare deploy of a project declaring an
 * agent was rejected, because the agent's transitive `@theokit/sdk` does exactly that in
 * `internal/providers/catalog-loader.ts`.
 *
 *     ✘ Uncaught TypeError: The "path" argument must be of type string or an instance of URL.
 *       Received undefined
 *         at fileURLToPath (node-internal:internal_url:155:15)
 *         at … /@theokit/sdk/… in __init                                    [code: 10021]
 *
 * wrangler's config carries esbuild's `define`, so substituting a literal makes that expression
 * resolve. Measured before and after on the same project: upload refused, then
 * `Uploaded theokit-b263-probe` with 307 assets, and `GET /api/agents/chat` moved from **404** to
 * **403 CSRF_FAILED** — a refusal from the route rather than the absence of one.
 *
 * ## What this compensation is, and what it is NOT
 *
 * It lets a module that only COMPUTES a path at load time initialise. It does not create a
 * filesystem. Anything that later tries to READ that path still fails, and on Workers it must. The
 * SDK's catalog sits behind a lazy `ensureModelIndexLoaded()`, so a turn does not need it; a turn
 * that did would now fail with an error about the catalog rather than one about `path` — the better
 * error, and still an error.
 *
 * The upstream fix is `usetheokit/theokit-sdk#705`. This is what the adapter can do today, and it is
 * emitted rather than documented because a deploy nobody can perform is not a supported target.
 */
import { describe, expect, it } from 'vitest'

import { renderWranglerToml } from '../../packages/theo/src/adapters/cloudflare.js'

describe('the worker config survives a module-scope dirname', () => {
  it('test_import_meta_url_is_defined', () => {
    const toml = renderWranglerToml({ ssrStreaming: true })

    expect(
      toml,
      'the generated wrangler.toml does not define `import.meta.url`, so any dependency resolving ' +
        'a path at module scope refuses the upload with code 10021 — Cloudflare executes the ' +
        'top-level module during validation',
    ).toMatch(/^\[define\]$/m)
    expect(toml).toContain('"import.meta.url"')
  })

  it('test_the_substituted_value_is_a_quoted_string_literal', () => {
    // esbuild substitutes the raw text. A bare `file:///worker` would be spliced in as an
    // identifier and the worker would fail to parse — a build error instead of an upload error, which
    // is the same target broken in a place that is harder to attribute.
    const toml = renderWranglerToml({ ssrStreaming: true })
    const line = /^"import\.meta\.url" = "(.*)"$/m.exec(toml)

    expect(line, 'no `import.meta.url` assignment to read').not.toBeNull()
    // TOML unescapes `\"` to `"`, so what reaches esbuild must open and close with a quote.
    const value = (line?.[1] ?? '').replace(/\\"/g, '"')
    expect(value.startsWith('"') && value.endsWith('"'), `esbuild receives ${value}`).toBe(true)
  })

  it('test_it_is_a_file_url_because_fileURLToPath_is_what_consumes_it', () => {
    // The expression that failed is `fileURLToPath(import.meta.url)`, which throws on anything that
    // is not a file URL. A non-URL literal would move the failure from `Received undefined` to
    // `Invalid URL` — still 10021, still no deploy.
    const toml = renderWranglerToml({ ssrStreaming: true })
    const value = (/^"import\.meta\.url" = "(.*)"$/m.exec(toml)?.[1] ?? '').replace(/\\"/g, '"')

    expect(value).toMatch(/^"file:\/\/\//)
    // The real consumer, exercised rather than described: this is the call that refused the upload.
    expect(() => new URL(JSON.parse(value) as string)).not.toThrow()
  })

  it('test_the_define_is_present_on_both_rendering_modes', () => {
    // COUNTERPROOF against tying the compensation to `ssrStreaming`. The dependency is pulled in by
    // an AGENT, and an agent is orthogonal to how the document is rendered — gating it on the flag
    // would leave the non-streaming target broken for a reason nothing in the output explains.
    expect(renderWranglerToml({ ssrStreaming: false })).toMatch(/^\[define\]$/m)
    expect(renderWranglerToml()).toMatch(/^\[define\]$/m)
  })

  it('test_the_define_block_does_not_swallow_the_keys_after_it', () => {
    // TOML tables are greedy: every key after `[define]` belongs to it until the next header. Placing
    // the block above `[assets]` would silently move `directory`, `binding` and `run_worker_first`
    // into `define` — a config that parses, deploys, and serves no assets.
    const toml = renderWranglerToml({ ssrStreaming: true })
    const define = toml.indexOf('[define]')
    const assets = toml.indexOf('[assets]')

    expect(define).toBeGreaterThan(-1)
    expect(assets).toBeGreaterThan(-1)
    expect(
      define > assets,
      '`[define]` precedes `[assets]`, so the asset keys are parsed as define entries and the ' +
        'worker deploys with no static assets bound',
    ).toBe(true)
  })
})
