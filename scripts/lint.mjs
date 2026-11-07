// `pnpm lint` entry point. See lint-partitions.mjs for why the lint runs in several processes.
import { spawnSync } from 'node:child_process'

import { lintInvocations, MAX_OLD_SPACE_MB } from './lint-partitions.mjs'

const extra = process.argv.slice(2)
const heap = process.env.THEOKIT_LINT_MAX_OLD_SPACE_MB ?? String(MAX_OLD_SPACE_MB)
const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=${heap}`.trim()

let status = 0
for (const args of lintInvocations()) {
  const r = spawnSync('pnpm', ['exec', 'eslint', ...args, ...extra], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  })
  if (r.status !== 0) status = r.status ?? 1
}
process.exit(status)
