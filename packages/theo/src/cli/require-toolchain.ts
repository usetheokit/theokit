import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Build-time packages `theokit` loads for the CLI only; they are optional peers, not dependencies. */
export const CLI_TOOLCHAIN = ['vite', '@vitejs/plugin-react', 'tsx', 'typescript'] as const

/** Throw a clear error naming the first toolchain package the app does not have installed. */
export function requireToolchain(
  names: readonly string[] = CLI_TOOLCHAIN,
  from: string = process.cwd(),
): void {
  const req = createRequire(join(from, 'package.json'))
  for (const name of names) {
    try {
      req.resolve(`${name}/package.json`)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // A package that hides package.json behind "exports" is still installed.
      if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') continue
      throw new Error(
        `theokit needs "${name}" to run this command, and it is not installed. ` +
          `Install it with: npm install --save-dev ${name}`,
      )
    }
  }
}
