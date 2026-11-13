/** Types for `check-app-dependencies.mjs`. */
export function runCli(options: {
  appDir: string
  json?: boolean
  write: (line: string) => void
  writeError: (line: string) => void
  tagsFor?: (name: string) => Record<string, string | undefined>
}): number
