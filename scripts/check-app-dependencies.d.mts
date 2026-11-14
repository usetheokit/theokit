/** Types for `check-app-dependencies.mjs`. */
export function runCli(options: {
  appDir: string
  json?: boolean
  write: (line: string) => void
  writeError: (line: string) => void
  /** Published dist-tags for a package; defaults to `npm view <name> dist-tags --json`. */
  publishedTags?: (name: string) => Record<string, string>
}): number
