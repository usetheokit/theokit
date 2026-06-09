/* eslint-disable security/detect-non-literal-fs-filename --
 * The SWC loader reads/writes controller files by absolute path derived
 * from developer-authored glob patterns in theo.config.ts, not from HTTP
 * input. The file paths come from scanControllerFiles() which walks the
 * project's own source tree. No injection vector.
 */
/**
 * SWC-powered module loader for controller files with parameter decorators.
 *
 * esbuild (used by tsx/Vite SSR) fundamentally cannot parse TypeScript
 * parameter decorators (`@Body()`, `@Param()`, `@Query()`). This loader
 * uses @swc/core to transform controller files with full decorator support
 * (legacyDecorator + decoratorMetadata), then imports them via a temp .mjs
 * file written in the SAME directory (preserving relative import resolution).
 *
 * Pattern: follows Next.js's approach (read tsconfig → configure SWC)
 * but scoped to the http-decorators package, not the framework core.
 *
 * @see references/next.js/packages/next/src/build/swc/options.ts
 */
import 'reflect-metadata'
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname, join, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { HttpDecoratorsConfigError } from './errors.js'

/** Extract jsc.target from parsed .swcrc or fall back to es2022. */
function getSwcrcTarget(swcrc: Record<string, unknown> | null): string {
  if (!swcrc) return 'es2022'
  const jsc = swcrc.jsc
  if (typeof jsc !== 'object' || jsc === null) return 'es2022'
  const target = (jsc as Record<string, unknown>).target
  return typeof target === 'string' ? target : 'es2022'
}

/** Cached consumer .swcrc — read once per process. */
let consumerSwcrcCache: Record<string, unknown> | null | undefined

/**
 * Walk up from the controller file's directory to find a .swcrc.
 * Returns the parsed JSON or null if none found.
 * Caches the result — .swcrc doesn't change at runtime.
 */
function readConsumerSwcrc(startDir: string): Record<string, unknown> | null {
  if (consumerSwcrcCache !== undefined) return consumerSwcrcCache

  let dir = startDir
  const root = dirname(dir) // stop at filesystem root
  while (dir !== root) {
    const candidate = join(dir, '.swcrc')
    try {
      const raw = readFileSync(candidate, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      // Strip $schema — not an SWC transform option
      delete parsed.$schema
      consumerSwcrcCache = parsed
      return parsed
    } catch {
      // File doesn't exist or invalid JSON — walk up
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  consumerSwcrcCache = null
  return null
}

interface SwcCore {
  transformSync: (src: string, opts: unknown) => { code: string }
}

/** Cached @swc/core instance — loaded once, reused across all controller files. */
let swcCoreCache: SwcCore | null | undefined

/**
 * Dynamically load @swc/core with singleton cache.
 *
 * Handles pnpm strict node_modules: @swc/core is only directly importable
 * from the package that declares it as a dependency. We use createRequire
 * rooted at THIS package's directory to resolve correctly.
 *
 * The cache ensures the ~50ms dynamic import() cost is paid ONCE,
 * not per-controller-file.
 */
async function loadSwcCore(): Promise<SwcCore | null> {
  if (swcCoreCache !== undefined) return swcCoreCache

  try {
    swcCoreCache = (await import('@swc/core')) as SwcCore
  } catch {
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url))
      const req = createRequire(resolve(thisDir, 'index.js'))
      const resolved = req.resolve('@swc/core')
      swcCoreCache = (await import(pathToFileURL(resolved).href)) as SwcCore
    } catch {
      swcCoreCache = null
    }
  }
  return swcCoreCache
}

/**
 * Load a TypeScript controller file using @swc/core for decorator support.
 *
 * Strategy:
 *   1. Read source .ts file
 *   2. Transform via @swc/core with legacyDecorator + decoratorMetadata
 *   3. Write temp .mjs in SAME directory (relative imports resolve correctly)
 *   4. Dynamic import() the .mjs — transitive .ts imports go through
 *      tsx/Vite's global hook (they don't have parameter decorators)
 *   5. Cleanup temp file
 */
export async function loadControllerWithSwc(
  absoluteFilePath: string,
): Promise<Record<string, unknown>> {
  const swc = await loadSwcCore()
  if (!swc) {
    throw new HttpDecoratorsConfigError(
      `@swc/core is required for parameter decorators (@Body, @Param, @Query). ` +
        `Install it:\n\n  pnpm add -D @swc/core\n\n` +
        `esbuild (used by tsx/Vite) cannot parse parameter decorators. ` +
        `SWC handles them correctly with full metadata emission.`,
    )
  }

  const source = readFileSync(absoluteFilePath, 'utf-8')
  const consumerSwcrc = readConsumerSwcrc(dirname(absoluteFilePath))
  const { code } = swc.transformSync(source, {
    filename: absoluteFilePath,
    jsc: {
      parser: {
        syntax: 'typescript',
        decorators: true,
        ...(consumerSwcrc?.jsc?.parser as Record<string, unknown>),
      },
      transform: {
        ...(consumerSwcrc?.jsc?.transform as Record<string, unknown>),
        // NON-NEGOTIABLE — always enforce decorator metadata emission
        // regardless of consumer .swcrc overrides
        legacyDecorator: true,
        decoratorMetadata: true,
      },
      target: getSwcrcTarget(consumerSwcrc),
    },
    module: { type: 'es6' },
    sourceMaps: false,
  })

  // Write temp .mjs in SAME directory so relative imports resolve identically.
  // .mjs = Node treats as ESM regardless of package.json type field.
  // Transitive .ts imports go through tsx's global hook (no param decorators there).
  const tmpPath = absoluteFilePath.replace(/\.ts$/, '.__decorated__.mjs')
  writeFileSync(tmpPath, code, 'utf-8')
  try {
    const url = pathToFileURL(tmpPath).href + `?t=${Date.now()}`
    return (await import(url)) as Record<string, unknown>
  } finally {
    try {
      unlinkSync(tmpPath)
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Scan a glob pattern for controller files and load them all via SWC.
 * Returns an array of controller class constructors found.
 */
export async function loadControllersFromGlob(
  rootDir: string,
  pattern: string,
): Promise<Function[]> {
  const files = scanControllerFiles(rootDir, pattern)
  if (files.length === 0) {
    console.warn(
      `[@theokit/http-decorators] No controller files found matching "${pattern}" ` +
        `in ${rootDir}. Ensure files match the pattern and export @Controller classes.`,
    )
    return []
  }

  const controllers: Function[] = []
  for (const file of files) {
    const absPath = resolve(rootDir, file)
    const mod = await loadControllerWithSwc(absPath)
    for (const exported of Object.values(mod)) {
      if (typeof exported === 'function' && isControllerClass(exported)) {
        controllers.push(exported)
      }
    }
  }

  return controllers
}

/**
 * Check if a function has @Controller metadata.
 * Uses Symbol.for() global registry key — same Symbol instance across
 * module boundaries (SWC-loaded controllers share the global registry).
 */
function isControllerClass(fn: Function): boolean {
  try {
    return Reflect.hasMetadata(Symbol.for('theokit:http-decorators:controller-prefix'), fn)
  } catch {
    return false
  }
}

/**
 * Scan for files matching a controller glob pattern.
 * Extracts the static directory prefix and file suffix from the pattern,
 * then recursively walks the directory.
 */
function scanControllerFiles(rootDir: string, pattern: string): string[] {
  const parts = pattern.split('/')
  const dirParts: string[] = []
  for (const part of parts) {
    if (part.includes('*')) break
    dirParts.push(part)
  }
  const baseDir = join(rootDir, ...dirParts)

  // Extract file suffix (e.g., '*.controller.ts' → '.controller.ts')
  const lastPart = parts[parts.length - 1]
  const suffix = lastPart.replace(/\*/g, '')

  const files: string[] = []
  function walk(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(suffix)) files.push(relative(rootDir, full))
      }
    } catch {
      // Directory doesn't exist
    }
  }
  walk(baseDir)
  return files
}
