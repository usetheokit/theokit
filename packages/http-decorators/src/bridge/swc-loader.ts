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

interface SwcCore {
  transformSync: (src: string, opts: unknown) => { code: string }
}

/**
 * Dynamically load @swc/core, handling pnpm strict node_modules.
 * In pnpm, @swc/core is only directly importable from the package
 * that declares it as a dependency. We use createRequire rooted at
 * THIS package's directory to resolve correctly.
 */
async function loadSwcCore(): Promise<SwcCore | null> {
  try {
    return (await import('@swc/core')) as SwcCore
  } catch {
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url))
      const req = createRequire(resolve(thisDir, 'index.js'))
      const resolved = req.resolve('@swc/core')
      return (await import(pathToFileURL(resolved).href)) as SwcCore
    } catch {
      return null
    }
  }
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
  const { code } = swc.transformSync(source, {
    filename: absoluteFilePath,
    jsc: {
      parser: {
        syntax: 'typescript',
        decorators: true,
      },
      transform: {
        legacyDecorator: true,
        decoratorMetadata: true,
      },
      target: 'es2022',
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
