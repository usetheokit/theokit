#!/usr/bin/env node
// `pnpm parity`: with --id or --all, the runtime harness (#1591); otherwise the ledger checker (B-404).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { runCli } from './parity/harness.mjs'

const argv = process.argv.slice(2)
if (argv.includes('--id') || argv.includes('--all')) {
  process.exitCode = await runCli(argv)
} else {
  const checker = fileURLToPath(new URL('./check-parity-ledger.mjs', import.meta.url))
  process.exitCode = spawnSync(process.execPath, [checker, ...argv], { stdio: 'inherit' }).status ?? 1
}
