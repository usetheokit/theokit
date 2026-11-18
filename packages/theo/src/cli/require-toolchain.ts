import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Build-time packages `theokit` loads for the CLI only; they are optional peers, not dependencies (`tsx` stays a dependency: `theokit start` loads TypeScript source). */
export const CLI_TOOLCHAIN = ['vite', '@vitejs/plugin-react', 'typescript'] as const

/** Throw a clear error naming the first toolchain package the app does not have installed. */
export function requireToolchain(
  names: readonly string[] = CLI_TOOLCHAIN,
  from: string = process.cwd(),
): void {
  // The app's own node_modules first, then wherever theokit itself is installed.
  const resolvers = [join(from, 'package.json'), fileURLToPath(import.meta.url)].map((p) =>
    createRequire(p),
  )
  for (const name of names) {
    if (!resolvers.some((req) => isInstalled(req, name))) {
      throw new Error(
        `theokit needs "${name}" to run this command, and it is not installed. ` +
          `Install it with: npm install --save-dev ${name}`,
      )
    }
  }
}

function isInstalled(req: NodeJS.Require, name: string): boolean {
  try {
    req.resolve(`${name}/package.json`)
    return true
  } catch (err) {
    // A package that hides package.json behind "exports" is still installed.
    return (err as NodeJS.ErrnoException).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  }
}
