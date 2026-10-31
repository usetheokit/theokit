import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { isPair, parseDocument, visit } from 'yaml'

import { type DroppedEntry, type ForeignSetup, normaliseMcpMap, readCapped, readSkillsDir, readTextFiles } from './foreign-setup.js'
import { isPlainObject, type NormalisedMcp } from './mcp-entry.js'

/** Hermes keeps its channels here; none of them is imported (FR-003). */
const CHANNEL_ENTRIES = ['platforms', 'channel_directory.json'] as const

/**
 * A Hermes home (FR-002): `SOUL.md` then `AGENTS.md`, the MCP map of `config.yaml`, the skills
 * under `skills/`, and `memories/MEMORY.md` then `memories/USER.md`. Dropped paths are relative
 * to `root`; an MCP entry is `config.yaml#<server>`.
 */
export function readHermesSetup(input: { readonly root: string }): ForeignSetup {
  const { root } = input
  const dropped: DroppedEntry[] = []
  const instructions = readTextFiles(
    [
      [join(root, 'SOUL.md'), 'SOUL.md'],
      [join(root, 'AGENTS.md'), 'AGENTS.md'],
    ],
    dropped,
  )
  const mcpServers = readMcpServers(root, dropped)
  const skills = readSkillsDir(join(root, 'skills'), 'skills', dropped)
  const memories = readTextFiles(
    [
      [join(root, 'memories', 'MEMORY.md'), 'memories/MEMORY.md'],
      [join(root, 'memories', 'USER.md'), 'memories/USER.md'],
    ],
    dropped,
  )
  for (const entry of CHANNEL_ENTRIES) {
    if (existsSync(join(root, entry))) dropped.push({ path: entry, reason: 'channels are not imported' })
  }
  return { kind: 'hermes', source: root, instructions, mcpServers, skills, memories, dropped }
}

/** `mcp_servers`, else `mcp.servers`, else `mcp`: the first that is a map. */
function pickMcpMap(config: Record<string, unknown>): Record<string, unknown> {
  const mcp = config.mcp
  const candidates = [config.mcp_servers, isPlainObject(mcp) ? mcp.servers : undefined, mcp]
  return candidates.find(isPlainObject) ?? {}
}

/**
 * `config.yaml` as data, read as Hermes's own YAML 1.1 reader (PyYAML) reads it: merge keys
 * (`<<: *defaults`) apply and a repeated key takes its last value. Every number written as a map
 * value, anywhere in the document, is kept as its source text: YAML reads `0x1F` as 31 and `1.10`
 * as 1.1, and an `env` or `headers` value must reach the server as the author wrote it (a map an
 * alias reuses included). A number in a list stays a number, so `args: [1, 2]` is still dropped as
 * not strings; a number anchored inside a list and aliased as a map value is not covered.
 */
function parseConfig(text: string): unknown {
  const doc = parseDocument(text, { merge: true, uniqueKeys: false })
  if (doc.errors.length > 0) throw doc.errors[0]
  visit(doc, {
    Scalar(_index, node, path) {
      const parent = path[path.length - 1]
      if (typeof node.value === 'number' && node.source !== undefined && isPair(parent) && parent.value === node) node.value = node.source
    },
  })
  return doc.toJS()
}

function readMcpServers(root: string, dropped: DroppedEntry[]): Record<string, NormalisedMcp> {
  const text = readCapped(join(root, 'config.yaml'), 'config.yaml', dropped)
  if (text === undefined) return {}
  let config: unknown
  try {
    config = parseConfig(text)
  } catch {
    // FR-003 fixes the reason; YAML's own message may quote the line, which can hold a value.
    dropped.push({ path: 'config.yaml', reason: 'not valid YAML' })
    return {}
  }
  return normaliseMcpMap(isPlainObject(config) ? pickMcpMap(config) : {}, 'config.yaml', dropped)
}
