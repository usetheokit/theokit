import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { listClaws } from '../routing/claws.js'

/**
 * `theoclaw path resolve|find|set|validate oc://<agent>/<file>[#<fragment>]` (OC-138): addresses a
 * section of a workspace Markdown file (`#Rules`, nested `#Rules/Style`, matched on heading text
 * without case) or a leaf of a workspace JSON file (`#server.ports.0`). `main` is the instance
 * workspace (THEOCLAW_WORKSPACE, else the current directory); other ids are installed claws.
 */

export interface OcPathIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly cwd: string
  readonly stdout: Writable
  readonly stderr: Writable
}

export interface OcAddress {
  readonly agent: string
  readonly file: string
  readonly fragment: string | undefined
}

export function parseOcAddress(text: string): OcAddress {
  const match = /^oc:\/\/([^/#]+)\/([^#]+)(?:#(.*))?$/.exec(text)
  if (match === null) throw new UsageError(`theoclaw path: "${text}" is not an oc://<agent>/<file>[#<fragment>] address`)
  const file = decodeURIComponent(match[2]!)
  if (file.split('/').includes('..')) throw new UsageError('theoclaw path: the file must stay inside the workspace')
  const fragment = match[3] === undefined || match[3] === '' ? undefined : decodeURIComponent(match[3])
  return { agent: match[1]!, file, fragment }
}

function workspaceOf(agent: string, io: OcPathIo): string {
  if (agent === 'main') {
    const configured = io.env.THEOCLAW_WORKSPACE?.trim()
    return configured !== undefined && configured !== '' ? configured : io.cwd
  }
  const claw = listClaws(io.env).find((entry) => entry.id === agent)
  if (claw === undefined) throw new UsageError(`theoclaw path: no agent ${agent} is installed`)
  return claw.workspace
}

function locate(address: OcAddress, io: OcPathIo): string {
  const root = resolve(io.cwd, workspaceOf(address.agent, io))
  const file = resolve(root, address.file)
  if (!existsSync(file)) throw new UsageError(`theoclaw path: ${address.file} does not exist in the ${address.agent} workspace`)
  const inside = relative(realpathSync(root), realpathSync(file))
  if (inside.startsWith('..') || isAbsolute(inside)) throw new UsageError('theoclaw path: the file must stay inside the workspace')
  return file
}

interface Section {
  readonly title: string
  readonly path: string
  readonly start: number
  readonly end: number
}

/** Heading sections of a Markdown text (fenced code ignored); `end` is exclusive. */
function sections(lines: readonly string[]): Section[] {
  const found: { level: number; title: string; path: string; start: number; end: number }[] = []
  const stack: { level: number; title: string }[] = []
  let fence = false
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const heading = fence ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading === null) return
    const level = heading[1]!.length
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
    stack.push({ level, title: heading[2]! })
    found.push({ level, title: heading[2]!, path: stack.map((entry) => entry.title).join('/'), start: index, end: lines.length })
  })
  found.forEach((section, i) => {
    const next = found.slice(i + 1).find((other) => other.level <= section.level)
    section.end = next === undefined ? lines.length : next.start
  })
  return found
}

function findSection(lines: readonly string[], fragment: string): Section {
  const wanted = fragment.toLowerCase()
  const all = sections(lines)
  const hit = all.find((s) => s.path.toLowerCase() === wanted) ?? all.find((s) => s.title.toLowerCase() === wanted) ??
    all.find((s) => s.path.toLowerCase().endsWith(`/${wanted}`))
  if (hit === undefined) throw new UsageError(`theoclaw path: no section "${fragment}"`)
  return hit
}

function leaves(value: unknown, prefix: string, out: string[]): string[] {
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) leaves(child, prefix === '' ? key : `${prefix}.${key}`, out)
  } else out.push(prefix)
  return out
}

function walk(root: unknown, fragment: string): { parent: Record<string, unknown>; key: string } {
  const keys = fragment.split('.')
  let node = root
  for (const key of keys.slice(0, -1)) {
    if (typeof node !== 'object' || node === null || !(key in node)) throw new UsageError(`theoclaw path: no value at "${fragment}"`)
    node = (node as Record<string, unknown>)[key]
  }
  const key = keys[keys.length - 1]!
  if (typeof node !== 'object' || node === null || !(key in node)) throw new UsageError(`theoclaw path: no value at "${fragment}"`)
  return { parent: node as Record<string, unknown>, key }
}

function isJson(file: string): boolean {
  return file.toLowerCase().endsWith('.json')
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new UsageError(`theoclaw path: ${file} is not valid JSON`)
  }
}

function resolveText(address: OcAddress, text: string): string {
  if (address.fragment === undefined) return text
  if (isJson(address.file)) {
    const { parent, key } = walk(parseJson(text, address.file), address.fragment)
    return `${JSON.stringify(parent[key], null, 2)}\n`
  }
  const lines = text.split('\n')
  const section = findSection(lines, address.fragment)
  return `${lines.slice(section.start, section.end).join('\n').replace(/\n+$/, '')}\n`
}

function setText(address: OcAddress, text: string, value: string): string {
  if (address.fragment === undefined) throw new UsageError('theoclaw path set: the address needs a #fragment')
  if (isJson(address.file)) {
    const root = parseJson(text, address.file)
    const { parent, key } = walk(root, address.fragment)
    let parsed: unknown = value
    try {
      parsed = JSON.parse(value)
    } catch {
      /* a bare word is a string */
    }
    parent[key] = parsed
    return `${JSON.stringify(root, null, 2)}\n`
  }
  const lines = text.split('\n')
  const section = findSection(lines, address.fragment)
  const body = value === '' ? [] : ['', ...value.replace(/\n+$/, '').split('\n'), '']
  return [...lines.slice(0, section.start + 1), ...body, ...lines.slice(section.end)].join('\n')
}

export async function pathCommand(args: readonly string[], io: OcPathIo): Promise<number> {
  loadConfiguration(io.env, io.homeDir)
  const dryRun = args.includes('--dry-run')
  const [action, uri, ...rest] = args.filter((arg) => arg !== '--dry-run')
  const usage = 'theoclaw path: expected resolve|find|validate <oc://agent/file[#fragment]> | set <oc://...> <value> [--dry-run]'
  if (uri === undefined || !['resolve', 'find', 'validate', 'set'].includes(action ?? '')) throw new UsageError(usage)
  if (rest.length !== (action === 'set' ? 1 : 0) || (dryRun && action !== 'set')) throw new UsageError(usage)
  const address = parseOcAddress(uri)
  const file = locate(address, io)
  const text = readFileSync(file, 'utf8')
  if (action === 'find') {
    const needle = (address.fragment ?? '').toLowerCase()
    const all = isJson(address.file)
      ? leaves(parseJson(text, address.file), '', [])
      : sections(text.split('\n')).map((section) => section.path)
    for (const entry of all.filter((candidate) => candidate.toLowerCase().includes(needle))) {
      io.stdout.write(`oc://${address.agent}/${address.file}#${entry}\n`)
    }
    return 0
  }
  if (action === 'set') {
    const next = setText(address, text, rest[0]!)
    if (dryRun) io.stdout.write(next)
    else {
      writeFileSync(file, next)
      io.stdout.write(`Set ${uri}\n`)
    }
    return 0
  }
  const out = resolveText(address, text)
  if (action === 'resolve') io.stdout.write(out)
  else io.stdout.write(`ok ${uri}\n`)
  return 0
}

