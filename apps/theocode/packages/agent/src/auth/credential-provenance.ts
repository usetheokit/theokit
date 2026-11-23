import type { SourceOrigin } from '@theokit/agents/auth'

/** `dotenvKeys` are the names the bootstrap's project-env step actually loaded from the `.env`. */
export function describeSource(
  origin: SourceOrigin,
  dotenvKeys: ReadonlySet<string>,
  dotenvPath: string,
): string {
  if (origin.kind === 'oauth') return `oauth (${origin.provider})`
  if (origin.kind === 'file') return origin.path
  return dotenvKeys.has(origin.varName)
    ? `${origin.varName} (${dotenvPath})`
    : `${origin.varName} (shell)`
}
