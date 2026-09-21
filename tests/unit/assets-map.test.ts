/**
 * The route-to-chunks map (B-035). These tests run against a hand-built bundle rather than a real
 * one: a build takes ~6s and the behaviour worth protecting is the graph walk, not Rollup.
 *
 * The acceptance criteria exercise the real build; these exercise the cases a build of the default
 * scaffold does NOT produce — a route whose chunks are all in the entry, a dynamic import that must
 * not be followed, a page outside the app directory.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadAssetsMap } from '../../packages/theo/src/cli/commands/start/ssr-setup.js'
import { injectModulePreloads } from '../../packages/theo/src/core/contracts/module-preloads.js'

import {
  buildAssetsMap,
  routePathForPageFile,
  type BundleChunk,
} from '../../packages/theo/src/vite-plugin/assets-map.js'

const APP = '/project/src/app'

/**
 * A bundle chunk with the two fields every fixture shares, plus whatever the case needs.
 *
 * The overrides were typed `Record<string, unknown>`, which erased them: the spread produced
 * `{ type: string; imports: never[] }` and every `fileName` a fixture passed was invisible to the
 * compiler. The per-package `tsc` never saw it — these tests live at the root — and the pre-push
 * hook did, which is where it was caught.
 */
const chunk = (over: Partial<BundleChunk> & { fileName: string }): BundleChunk => ({
  type: 'chunk',
  imports: [],
  ...over,
})

describe('routePathForPageFile', () => {
  it('maps the app root page to /', () => {
    expect(routePathForPageFile(APP, `${APP}/page.tsx`)).toBe('/')
  })

  it('maps a nested page to its directory path', () => {
    expect(routePathForPageFile(APP, `${APP}/about/page.tsx`)).toBe('/about')
    expect(routePathForPageFile(APP, `${APP}/blog/archive/page.tsx`)).toBe('/blog/archive')
  })

  it('accepts the other page extensions the router accepts', () => {
    expect(routePathForPageFile(APP, `${APP}/a/page.jsx`)).toBe('/a')
    expect(routePathForPageFile(APP, `${APP}/b/page.ts`)).toBe('/b')
  })

  it('refuses a file that is not a page', () => {
    expect(routePathForPageFile(APP, `${APP}/about/layout.tsx`)).toBeUndefined()
    expect(routePathForPageFile(APP, `${APP}/about/pageant.tsx`)).toBeUndefined()
  })

  it('refuses a page outside the app directory', () => {
    expect(routePathForPageFile(APP, '/project/src/server/page.tsx')).toBeUndefined()
    // A sibling directory whose name merely starts with the app dir must not match.
    expect(routePathForPageFile(APP, '/project/src/app-legacy/page.tsx')).toBeUndefined()
  })
})

describe('buildAssetsMap', () => {
  it('lists the chunks a route needs beyond the entry', () => {
    const bundle = {
      'entry.js': chunk({ isEntry: true, fileName: 'entry.js', imports: ['shared.js'] }),
      'shared.js': chunk({ fileName: 'shared.js' }),
      'page-a.js': chunk({
        fileName: 'page-a.js',
        facadeModuleId: `${APP}/page.tsx`,
        imports: ['lib.js'],
      }),
      'lib.js': chunk({ fileName: 'lib.js' }),
    }
    expect(buildAssetsMap(bundle, APP)).toEqual({ '/': ['lib.js', 'page-a.js'] })
  })

  it('emits an empty array for a route whose chunks the entry already loads', () => {
    // This is the case an implementation that preloads everything gets wrong, and the one
    // AC-003 fails at the integration level. The empty array is the honest answer, not an omission.
    const bundle = {
      'entry.js': chunk({ isEntry: true, fileName: 'entry.js', imports: ['page-a.js'] }),
      'page-a.js': chunk({ fileName: 'page-a.js', facadeModuleId: `${APP}/page.tsx` }),
    }
    expect(buildAssetsMap(bundle, APP)).toEqual({ '/': [] })
  })

  it('does not follow dynamic imports', () => {
    // A dynamic import is by definition what the browser fetches later; preloading it would
    // undo the split that produced it.
    const bundle = {
      'entry.js': chunk({ isEntry: true, fileName: 'entry.js' }),
      'page-a.js': chunk({
        fileName: 'page-a.js',
        facadeModuleId: `${APP}/page.tsx`,
        imports: [],
        dynamicImports: ['later.js'],
      }),
      'later.js': chunk({ fileName: 'later.js' }),
    }
    expect(buildAssetsMap(bundle, APP)).toEqual({ '/': ['page-a.js'] })
  })

  it('ignores assets and chunks that face no module', () => {
    const bundle = {
      'entry.js': chunk({ isEntry: true, fileName: 'entry.js' }),
      'style.css': { type: 'asset', fileName: 'style.css' },
      'vendor.js': chunk({ fileName: 'vendor.js', facadeModuleId: null }),
    }
    expect(buildAssetsMap(bundle, APP)).toEqual({})
  })

  it('terminates on a cycle rather than hanging', () => {
    const bundle = {
      'entry.js': chunk({ isEntry: true, fileName: 'entry.js' }),
      'page-a.js': chunk({
        fileName: 'page-a.js',
        facadeModuleId: `${APP}/page.tsx`,
        imports: ['x.js'],
      }),
      'x.js': chunk({ fileName: 'x.js', imports: ['y.js'] }),
      'y.js': chunk({ fileName: 'y.js', imports: ['x.js'] }),
    }
    expect(buildAssetsMap(bundle, APP)).toEqual({ '/': ['page-a.js', 'x.js', 'y.js'] })
  })
})

describe('loadAssetsMap', () => {
  const tmp = (name: string, body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'assets-map-'))
    const path = join(dir, name)
    writeFileSync(path, body)
    return path
  }

  it('reads a well-formed map', () => {
    expect(loadAssetsMap(tmp('m.json', '{"/a":["x.js"]}'))).toEqual({ '/a': ['x.js'] })
  })

  // The negative cases matter more than the positive one here: this runs at server startup, and
  // every one of them must degrade to "serve without preloads" rather than refuse to boot. A
  // missing optimisation is not an outage, and turning it into one would be the worse failure.
  it('returns undefined when the file is absent', () => {
    expect(loadAssetsMap(join(tmpdir(), 'assets-map-does-not-exist', 'm.json'))).toBeUndefined()
  })

  it('returns undefined on malformed JSON', () => {
    expect(loadAssetsMap(tmp('m.json', '{ not json'))).toBeUndefined()
  })

  it('returns undefined when the document is an array or a scalar', () => {
    expect(loadAssetsMap(tmp('a.json', '["/a"]'))).toBeUndefined()
    expect(loadAssetsMap(tmp('b.json', '42'))).toBeUndefined()
    expect(loadAssetsMap(tmp('c.json', 'null'))).toBeUndefined()
  })

  it('drops an entry whose value is not an array of strings, keeping the rest', () => {
    expect(loadAssetsMap(tmp('m.json', '{"/a":["x.js"],"/b":"x.js","/c":[1]}'))).toEqual({
      '/a': ['x.js'],
    })
  })

  it('returns undefined when nothing survives the filter', () => {
    expect(loadAssetsMap(tmp('m.json', '{"/b":"x.js"}'))).toBeUndefined()
  })
})

describe('injectModulePreloads — the request target is not always a path', () => {
  const MAP = { '/about': ['assets/a.js'] }
  const HEAD = '<head></head>'

  // Found at review, B-035. The two call sites feed this function DIFFERENT shapes:
  // `request-handler.ts:240` passes `req.url` raw, and `cloudflare.ts:284` passes
  // `new URL(request.url).pathname`. RFC 9112 §3.2.2 requires a server to accept the
  // absolute form, and a proxy sends it — so on Node behind a proxy the route never matched
  // and the whole feature silently did nothing, while the worker worked. The equivalence
  // test could not see it: it fed both implementations the same string.
  it('matches the route when the target is absolute-form, as a proxy sends it', () => {
    expect(injectModulePreloads(HEAD, MAP, 'http://example.com/about')).toContain('modulepreload')
  })

  it('matches with an absolute-form target carrying a query', () => {
    expect(injectModulePreloads(HEAD, MAP, 'https://example.com/about?ref=x')).toContain(
      'modulepreload',
    )
  })

  it('still matches an ordinary origin-form target', () => {
    expect(injectModulePreloads(HEAD, MAP, '/about')).toContain('modulepreload')
  })

  it('does not invent a route from a target it cannot parse', () => {
    expect(injectModulePreloads(HEAD, MAP, 'not a url at all')).toBe(HEAD)
  })
})
