/**
 * @Sandbox() — declares file/command permission scope for code assistant agents.
 *
 * Controls what the agent can read, write, and execute. The runtime enforces
 * these permissions BEFORE tool execution — a tool that tries to write to a
 * denied path gets a typed error, not a crash.
 *
 * Inspired by Claude Code's permission system (allow/deny per tool + path).
 *
 * @example
 * ```ts
 * @Agent({ name: 'coder', route: '/agents/coder' })
 * @Sandbox({
 *   filesystem: {
 *     read: ['src/**', 'tests/**', 'package.json'],
 *     write: ['src/**', 'tests/**'],
 *     deny: ['node_modules/**', '.env', '*.key'],
 *   },
 *   commands: {
 *     allow: ['npm test', 'tsc --noEmit', 'git diff'],
 *     deny: ['rm -rf', 'git push --force', 'npm publish'],
 *   },
 *   network: false,
 * })
 * class CoderAgent { ... }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const SANDBOX_CONFIG = Symbol.for('theokit:agents:sandbox')

export interface FilesystemPermissions {
  /** Glob patterns for allowed read paths. */
  read?: string[]
  /** Glob patterns for allowed write paths. */
  write?: string[]
  /** Glob patterns for DENIED paths (overrides read/write). */
  deny?: string[]
}

export interface CommandPermissions {
  /** Command prefixes allowed to execute. */
  allow?: string[]
  /** Command prefixes denied (overrides allow). */
  deny?: string[]
}

export interface SandboxOptions {
  /** Filesystem read/write permissions. */
  filesystem?: FilesystemPermissions
  /** Shell command execution permissions. */
  commands?: CommandPermissions
  /** Allow outbound network from tools (default: true). */
  network?: boolean
  /** Maximum execution time per command in ms (default: 120_000). */
  commandTimeout?: number
  /** Working directory root (default: process.cwd()). */
  cwd?: string
}

export function Sandbox(options: SandboxOptions): ClassDecorator {
  return (target: Function) => {
    setMeta(SANDBOX_CONFIG, target, {
      network: true,
      commandTimeout: 120_000,
      ...options,
    })
  }
}

export function getSandboxConfig(target: Function): SandboxOptions | undefined {
  return getMeta<SandboxOptions>(SANDBOX_CONFIG, target)
}

/**
 * Check if a file path is allowed for the given operation.
 * Deny patterns always win over allow patterns.
 */
export function isPathAllowed(
  sandbox: SandboxOptions,
  filePath: string,
  operation: 'read' | 'write',
): boolean {
  const fs = sandbox.filesystem
  if (!fs) return true // no filesystem restrictions

  // Deny always wins
  if (fs.deny?.some((pattern) => matchGlob(pattern, filePath))) return false

  const allowList = operation === 'read' ? fs.read : fs.write
  if (!allowList) return true // no explicit allow = allow all (minus deny)

  return allowList.some((pattern) => matchGlob(pattern, filePath))
}

/**
 * Check if a command is allowed to execute.
 * Deny patterns always win over allow patterns.
 */
export function isCommandAllowed(sandbox: SandboxOptions, command: string): boolean {
  const cmds = sandbox.commands
  if (!cmds) return true

  // Deny always wins
  if (cmds.deny?.some((prefix) => command.startsWith(prefix))) return false

  if (!cmds.allow) return true // no explicit allow = allow all (minus deny)

  return cmds.allow.some((prefix) => command.startsWith(prefix))
}

/** Simple glob matcher (supports * and ** patterns). */
function matchGlob(pattern: string, path: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
  return new RegExp(`^${regex}$`).test(path)
}
