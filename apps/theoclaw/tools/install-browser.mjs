#!/usr/bin/env node
/**
 * Installs the Chromium build `THEOCLAW_BROWSER=on` needs (B-383), with the Playwright CLI that the
 * pinned `@playwright/mcp` depends on, so the browser matches the server's own Playwright version.
 *
 * pnpm does not expose `playwright` to the app, and its `exports` omit `cli.js`, so the CLI is
 * resolved from `@playwright/mcp`'s directory through `playwright/package.json` and its `bin`.
 *
 * Exits with the install's status, or 2 when the CLI cannot be found.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

function playwrightCli() {
  const mcpManifest = createRequire(import.meta.url).resolve('@playwright/mcp/package.json')
  const manifestPath = createRequire(mcpManifest).resolve('playwright/package.json')
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = typeof bin === 'string' ? bin : bin?.playwright
  if (typeof entry !== 'string') throw new Error(`${manifestPath} declares no playwright bin`)
  return join(dirname(manifestPath), entry)
}

/** The exit code of one install: the CLI's status, 1 when a signal killed it, 2 when it never ran. */
function install() {
  let cli
  try {
    cli = playwrightCli()
  } catch (error) {
    process.stderr.write(`browser:install: cannot find the Playwright CLI of @playwright/mcp (${error.message}); run \`pnpm install\`\n`)
    return 2
  }
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' })
  if (result.error !== undefined) {
    process.stderr.write(`browser:install: ${result.error.message}\n`)
    return 2
  }
  if (result.status === null) {
    process.stderr.write(`browser:install: the install was killed by ${String(result.signal)}\n`)
    return 1
  }
  return result.status
}

process.exitCode = install()
