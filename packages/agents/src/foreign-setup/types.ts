/** An MCP server in the shape the framework's `.mcp.json` carries. */
export type ForeignMcpServer =
  | {
      readonly command: string
      readonly args?: string[]
      readonly env?: Record<string, string>
      readonly cwd?: string
    }
  | {
      readonly type: 'http' | 'sse'
      readonly url: string
      readonly headers?: Record<string, string>
    }

export interface ForeignTextFile {
  /** Relative to the source. */
  readonly path: string
  readonly text: string
}

export interface ForeignSkill {
  readonly name: string
  readonly description: string
  readonly body: string
  /** Binaries from `metadata.requires.bins`; a consumer may offer the skill only while all are on PATH. */
  readonly requiresBins: readonly string[]
  /** Relative to the source. */
  readonly path: string
}

export interface ForeignHook {
  readonly event: string
  readonly command: string
  readonly matcher?: string
  readonly timeoutMs?: number
}

/** Something found in the setup that was not translated, and why. A reason never quotes a value. */
export interface UntranslatedEntry {
  readonly path: string
  readonly reason: string
}

export interface ForeignSetup {
  readonly kind: ForeignSetupKind
  readonly source: string
  readonly instructions: ForeignTextFile[]
  readonly skills: ForeignSkill[]
  /** Claude Code's auto memory for the project's git root (needs `cwd`); Hermes's `memories/` files. */
  readonly memories: ForeignTextFile[]
  readonly mcpServers: Record<string, ForeignMcpServer>
  readonly hooks: ForeignHook[]
  readonly untranslated: UntranslatedEntry[]
}

export type ForeignSetupKind = 'claude-code' | 'hermes'

export interface ReadForeignSetupOptions {
  /** The user's home directory; `.claude`, `.claude.json` or `.hermes` is read under it. */
  readonly home: string
  /** The project directory; its Claude Code scope (`CLAUDE.md`, `.mcp.json`, skills, settings) is read too. */
  readonly cwd?: string
  /** The source directory, replacing `<home>/.claude` (claude-code) or `<home>/.hermes` (hermes). */
  readonly configDir?: string
}
