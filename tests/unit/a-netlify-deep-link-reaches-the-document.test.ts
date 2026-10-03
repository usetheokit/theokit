/**
 * A client-routed page on Netlify answers with the document, not Netlify's 404 (#949).
 *
 * Measured 2026-10-03 on a `create-theokit@3.0.14` scaffold deployed to Netlify production:
 * `GET /about` answered 404 while the same build answered 200 on Vercel and Cloudflare. The emitted
 * `netlify.toml` routed `/api/*` to the function and nothing else, so no path but `/` reached
 * `index.html`.
 */
import { describe, expect, it } from 'vitest'

import { mergeNetlifyToml } from '../../packages/theo/src/adapters/netlify.js'

/** The `from` of every `[[redirects]]` block, in file order (Netlify applies the first match). */
function redirectSources(toml: string): string[] {
  return [...toml.matchAll(/^\s*from\s*=\s*"([^"]+)"/gmu)].map((m) => m[1] ?? '')
}

function blockFor(toml: string, from: string): string {
  const blocks = toml.split('[[redirects]]').slice(1)
  return blocks.find((b) => b.includes(`from = "${from}"`)) ?? ''
}

describe('the SPA fallback in netlify.toml', () => {
  it('test_a_fresh_file_serves_index_html_for_any_other_path', () => {
    const fallback = blockFor(mergeNetlifyToml(null), '/*')

    expect(fallback, 'no /* redirect: a deep link answers 404').toContain('to = "/index.html"')
    expect(fallback).toContain('status = 200')
  })

  it('test_the_fallback_is_not_forced_so_real_files_still_win', () => {
    // `force = true` would shadow /assets/*.js with the document.
    expect(blockFor(mergeNetlifyToml(null), '/*')).not.toContain('force')
  })

  it('test_the_api_rule_comes_before_the_fallback', () => {
    const sources = redirectSources(mergeNetlifyToml(null))

    expect(sources.indexOf('/api/*')).toBeGreaterThanOrEqual(0)
    expect(sources.indexOf('/api/*')).toBeLessThan(sources.indexOf('/*'))
  })

  it('test_a_rebuild_does_not_duplicate_it', () => {
    const twice = mergeNetlifyToml(mergeNetlifyToml(null))

    expect(redirectSources(twice).filter((s) => s === '/*')).toHaveLength(1)
  })

  it('test_a_project_rule_for_every_path_is_left_alone', () => {
    const existing = [
      '[[redirects]]',
      '  from = "/*"',
      '  to = "/app.html"',
      '  status = 200',
    ].join('\n')
    const merged = mergeNetlifyToml(existing)

    expect(redirectSources(merged).filter((s) => s === '/*')).toHaveLength(1)
    expect(merged).toContain('to = "/app.html"')
  })
})
