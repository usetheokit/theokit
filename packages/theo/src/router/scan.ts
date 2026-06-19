/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time file-system scanner. All paths originate from `appDir`,
 * which is itself derived from `process.cwd()`. No HTTP input flows here.
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { RouteNode, RouteFileName } from './types.js'
import { ROUTE_FILE_NAMES, ROUTE_FILE_EXTENSIONS } from './types.js'

function toNodeKey(name: RouteFileName): 'page' | 'layout' | 'error' | 'loading' | 'notFound' {
  if (name === 'not-found') return 'notFound'
  return name
}

function setRouteFile(
  node: RouteNode,
  key: 'page' | 'layout' | 'error' | 'loading' | 'notFound',
  value: string,
): void {
  switch (key) {
    case 'page':
      node.page = value
      break
    case 'layout':
      node.layout = value
      break
    case 'error':
      node.error = value
      break
    case 'loading':
      node.loading = value
      break
    case 'notFound':
      node.notFound = value
      break
  }
}

function attachRouteFiles(node: RouteNode, dir: string): void {
  // Check route files with extension priority (.tsx > .ts > .jsx > .js)
  for (const name of ROUTE_FILE_NAMES) {
    const key = toNodeKey(name)
    if (node[key] !== undefined) continue
    for (const ext of ROUTE_FILE_EXTENSIONS) {
      const filename = `${name}${ext}`
      if (existsSync(join(dir, filename))) {
        setRouteFile(node, key, resolve(dir, filename))
        break
      }
    }
  }
}

interface ParsedSegment {
  kind: 'static' | 'dynamic' | 'catchall'
  paramName?: string
}

/**
 * Classify a directory name as a static, dynamic (`[param]`), or catch-all
 * (`[...slug]`) route segment. Throws at build time on:
 *  - optional catch-all `[[...slug]]` (EC-4 — not supported yet; see plan Q3)
 *  - a param name outside `[A-Za-z0-9_]` (EC-5 — react-router would silently mis-match)
 * Order matters: catch-all is checked before single dynamic so `[...slug]` is
 * not misread as a dynamic param literally named `...slug`.
 */
function parseSegment(name: string): ParsedSegment {
  if (name.startsWith('[[')) {
    throw new Error(
      `Optional catch-all route segment is not supported yet: '${name}'. ` +
        `Use '[...param]' for catch-all, or split into explicit segments.`,
    )
  }
  const catchAll = /^\[\.\.\.(.+)\]$/.exec(name)
  if (catchAll) return checkedSegment('catchall', catchAll[1], name)
  const dynamic = /^\[(.+)\]$/.exec(name)
  if (dynamic) return checkedSegment('dynamic', dynamic[1], name)
  return { kind: 'static' }
}

function checkedSegment(
  kind: 'dynamic' | 'catchall',
  paramName: string,
  name: string,
): ParsedSegment {
  if (!/^\w+$/.test(paramName)) {
    throw new Error(
      `Invalid route param '${paramName}' in segment '${name}' — ` +
        `param names must match [A-Za-z0-9_] (react-router constraint).`,
    )
  }
  return { kind, paramName }
}

function nodeHasContent(node: RouteNode): boolean {
  return (
    node.page !== undefined ||
    node.layout !== undefined ||
    node.error !== undefined ||
    node.loading !== undefined ||
    node.notFound !== undefined ||
    node.children.length > 0
  )
}

function buildChildPath(routePath: string, urlSegment: string): string {
  if (!urlSegment) return routePath
  return routePath === '/' ? `/${urlSegment}` : `${routePath}/${urlSegment}`
}

/** Scan one subdirectory into a child RouteNode, attaching dynamic-segment metadata. */
function scanChild(parentDir: string, dirName: string, routePath: string): RouteNode {
  const isRouteGroup = dirName.startsWith('(') && dirName.endsWith(')')
  const urlSegment = isRouteGroup ? '' : dirName
  const childPath = buildChildPath(routePath, urlSegment)
  const child = scanDir(join(parentDir, dirName), isRouteGroup ? '' : dirName, childPath)

  // Dynamic / catch-all segment metadata (throws on [[...]] or invalid charset).
  if (!isRouteGroup) {
    const parsed = parseSegment(dirName)
    if (parsed.kind !== 'static' && parsed.paramName !== undefined) {
      child.dynamic = { paramName: parsed.paramName, catchAll: parsed.kind === 'catchall' }
    }
  }
  return child
}

function scanDir(dir: string, segment: string, routePath: string): RouteNode {
  const node: RouteNode = { segment, path: routePath, children: [] }
  attachRouteFiles(node, dir)

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue

    const child = scanChild(dir, entry.name, routePath)
    // Prune empty nodes — a directory with no route files AND no children is
    // irrelevant to the manifest.
    if (nodeHasContent(child)) {
      node.children.push(child)
    }
  }

  return node
}

export function scanRoutes(appDir: string): RouteNode {
  if (!existsSync(appDir)) {
    throw new Error(`App directory does not exist: ${appDir}`)
  }
  if (!statSync(appDir).isDirectory()) {
    throw new Error(`App path is not a directory: ${appDir}`)
  }
  return scanDir(appDir, '', '/')
}
