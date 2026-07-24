/* eslint-disable security/detect-non-literal-fs-filename --
 * transformIndexHtml extraction (T2.6 / M6). hasPackage probe reads
 * `node_modules/<name>` paths built from build-time projectRoot. No
 * HTTP input.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { injectDevtoolsScript } from './inject-devtools.js'
import { injectEntryClient } from './inject-entry-client.js'
import { injectStylesheets } from './inject-stylesheets.js'

interface TransformHtmlCtx {
  isDevMode: { value: boolean }
  devtoolsEnabled: boolean
  projectRoot: string
}

/**
 * Runs the 3-step HTML injection sequence in the canonical order:
 *   1. entry-client (always)
 *   2. devtools (dev only)
 *   3. stylesheets (dev only)
 * Order is part of the contract — devtools depends on entry-client
 * being present; stylesheets injection sits last so the <link>
 * follows the bundled <script>. EC-10 honored.
 */
export function runTransformIndexHtml(html: string, ctx: TransformHtmlCtx): string {
  // 1. entry-client (always)
  const entry = injectEntryClient(html)

  if (entry.warning) console.warn(entry.warning)
  let next = entry.html

  // 2. devtools (dev only, respecting config.devtools = false)
  const devtools = injectDevtoolsScript(next, {
    isDev: ctx.isDevMode.value,
    enabled: ctx.devtoolsEnabled,
  })

  if (devtools.warning) console.warn(devtools.warning)
  next = devtools.html

  // 3. Stylesheet link (dev only) — fixes LCP. Without the
  // <link rel="stylesheet">, CSS only loads after the JS bundle
  // executes `import 'styles.css'`, causing FOUC + LCP > 9s.
  // Production builds rely on Vite's SSR bundle for the
  // correctly-hashed <link>. Font preload was tried + reverted
  // (see inject-stylesheets.ts comment); CLS was hydration
  // mismatch, not font swap.
  const styles = injectStylesheets(next, {
    isDev: ctx.isDevMode.value,
    hasPackage: (name) => existsSync(resolve(ctx.projectRoot, 'node_modules', ...name.split('/'))),
  })
  next = styles.html

  return next
}
