import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Build-time packages `theokit` loads for the CLI only; they are optional peers, not dependencies. */
const CLI_TOOLCHAIN = ['vite', '@vitejs/plugin-react', 'typescript', 'tsx'] as const

/** Throw a clear error naming the first toolchain package the app does not have installed. */
export function requireToolchain(
  names: readonly string[] = CLI_TOOLCHAIN,
  from: string = process.cwd(),
): void {
  // Resolve from the app only: theokit's own location can see a hoisted copy the app never declared.
  const req = createRequire(join(from, 'package.json'))
  for (const name of names) {
    if (!isInstalled(req, name)) {
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

/**
 * Guard the toolchain, then register tsx's global ESM hook so user `.ts` files import natively.
 * This replaces the `import "tsx/esm"` the CLI bin used to start with, which ran before any guard.
 */
export async function useToolchain(names: readonly string[] = CLI_TOOLCHAIN): Promise<void> {
  requireToolchain(names)
  const { register } = await import('tsx/esm/api')
  register()
}
