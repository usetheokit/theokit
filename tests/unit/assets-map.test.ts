/**
 * The route-to-chunks map (B-035). These tests run against a hand-built bundle rather than a real
 * one: a build takes ~6s and the behaviour worth protecting is the graph walk, not Rollup.
 *
 * The acceptance criteria exercise the real build; these exercise the cases a build of the default
 * scaffold does NOT produce — a route whose chunks are all in the entry, a dynamic import that must
 * not be followed, a page outside the app directory.
 */
import { describe, expect, it } from 'vitest'

import {
  buildAssetsMap,
  routePathForPageFile,
} from '../../packages/theo/src/vite-plugin/assets-map.js'

const APP = '/project/src/app'

const chunk = (over: Record<string, unknown> = {}) => ({ type: 'chunk', imports: [], ...over })

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
