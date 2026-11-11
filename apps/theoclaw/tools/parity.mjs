#!/usr/bin/env node
/** `pnpm parity`: the harness when given `--id` or `--gate`, otherwise the ledger count. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2).filter((a) => a !== '--')
const harness = args.includes('--id') || args.includes('--gate')
const script = fileURLToPath(
  new URL(harness ? './parity-harness.mjs' : './check-parity-ledger.mjs', import.meta.url),
)
process.exitCode = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' }).status ?? 1
