export type SourceOrigin =
  | { kind: 'env'; varName: string }
  | { kind: 'file'; path: string }
  // M37 — an OAuth session. Carries the provider name only (never a token), so the footer can say
  // "oauth (anthropic)" and the user can tell an account login apart from a pasted API key or a .env value.
  | { kind: 'oauth'; provider: string }

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
