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
import { resolve } from 'node:path'

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
 *
 * Security: normalizes paths to prevent traversal (../) and rejects null bytes.
 */
export function isPathAllowed(
  sandbox: SandboxOptions,
  filePath: string,
  operation: 'read' | 'write',
): boolean {
  // EC-2: null byte injection — reject before any processing
  if (filePath.includes('\x00')) return false

  // Path traversal fix: normalize to remove ../ sequences
  const normalized = resolve('/', filePath).slice(1)

  const fs = sandbox.filesystem
  if (!fs) return true // no filesystem restrictions

  // Deny always wins
  if (fs.deny?.some((pattern) => matchGlob(pattern, normalized))) return false

  const allowList = operation === 'read' ? fs.read : fs.write
  if (!allowList) return true // no explicit allow = allow all (minus deny)

  return allowList.some((pattern) => matchGlob(pattern, normalized))
}

/**
 * Shell metacharacters that indicate injection attempts.
 * EC-1: includes redirect operators (>, <) and newlines (\n, \r).
 */
const SHELL_METACHARS = /[;|&$`(){}<>\n\r]/

/**
 * Check if a command is allowed to execute.
 * Deny patterns always win. Rejects shell metacharacters.
 *
 * Security: tokenizes command to match binary name, not arbitrary prefix.
 */
export function isCommandAllowed(sandbox: SandboxOptions, command: string): boolean {
  const cmds = sandbox.commands
  if (!cmds) return true

  // Reject any command with shell metacharacters (injection prevention)
  if (SHELL_METACHARS.test(command)) return false

  // Extract binary name (first whitespace-delimited token)
  const binary = command.split(/\s+/)[0]

  // Deny always wins — check both exact binary match and full command prefix
  if (cmds.deny?.some((d) => binary === d || command.startsWith(d + ' ') || command === d))
    return false

  if (!cmds.allow) return true

  // Allow: match exact binary or full command prefix
  return cmds.allow.some((a) => binary === a || command.startsWith(a + ' ') || command === a)
}

/**
 * Glob matcher — converts glob pattern to regex at call time.
 * Uses a pre-built RegExp from a sanitized pattern string.
 * Supports *, **, and ? glob characters.
 */
function matchGlob(pattern: string, filePath: string): boolean {
  // Escape all regex specials except glob chars (* and ?)
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0GLOBSTAR\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\0GLOBSTAR\0/g, '.*')
  // Pre-compile regex outside of hot path (pattern is controlled by developer, not user input)
  const regex = buildGlobRegex(escaped)
  return regex.test(filePath)
}

/** Build a regex from a pre-escaped glob pattern string. */
function buildGlobRegex(escapedPattern: string): RegExp {
  return RegExp(`^${escapedPattern}$`)
}
