import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const REPO = resolve(__dirname, '../..')

/** What `theokit` refuses to run its CLI without, resolved from the app (`require-toolchain.ts`). */
const TOOLCHAIN = ['vite', '@vitejs/plugin-react', 'typescript', 'tsx'] as const

/**
 * Links the CLI toolchain from the repository into a scratch app's `node_modules`, as installing it would.
 * A scratch app under the system temp directory sees no ancestor `node_modules`, and since the toolchain
 * became optional peers the CLI refuses an app that lacks it.
 */
export function linkToolchain(projectDir: string): void {
  for (const name of TOOLCHAIN) {
    const target = join(projectDir, 'node_modules', name)
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(resolve(REPO, 'node_modules', name), target, 'dir')
  }
}
