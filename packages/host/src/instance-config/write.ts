import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, linkSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { InstanceConfigError } from './errors.js'

import type { InstanceKey } from './index.js'

const KEY = /^[A-Za-z_]\w*$/

export function assertWritable(key: string, value: string): void {
  if (/["\\\r\n]/.test(value)) {
    throw new InstanceConfigError(
      'instance_config_unwritable_value',
      `the value of ${key} contains a double quote, backslash or line break, which the file cannot hold`,
    )
  }
}

function ensureDirectory(dir: string, app: string): void {
  if (existsSync(dir)) {
    if (basename(dir) === app && process.platform !== 'win32') chmodSync(dir, 0o700)
    return
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

function renderEntries(
  keys: Readonly<Record<string, InstanceKey>>,
  entries: Readonly<Record<string, string | undefined>>,
): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue
    if (!Object.hasOwn(keys, key) || !KEY.test(key) || key === '__proto__') {
      throw new InstanceConfigError('instance_config_unknown_key', `${key} is not a declared key`)
    }
    assertWritable(key, value)
    runParse(key, keys[key].parse, value)
    lines.push(`${key}="${value}"`)
  }
  return `${lines.join('\n')}\n`
}

function runParse(key: string, parse: InstanceKey['parse'], value: string): void {
  if (parse === undefined) return
  try {
    parse(value)
  } catch {
    // The parser's error may quote the raw value, so it is neither attached nor read.
    throw new InstanceConfigError(
      'instance_config_invalid_value',
      `the value of ${key} was refused by its parser`,
    )
  }
}

function existsError(path: string): InstanceConfigError {
  return new InstanceConfigError(
    'instance_config_exists',
    `${path} already exists; pass force to replace it`,
  )
}

function publish(tmp: string, path: string, force: boolean): void {
  if (force) {
    renameSync(tmp, path)
    return
  }
  // link fails with EEXIST when a concurrent writer got there first.
  try {
    linkSync(tmp, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw existsError(path)
    throw error
  }
  unlinkSync(tmp)
}

export async function writeInstanceConfig(
  app: string,
  keys: Readonly<Record<string, InstanceKey>>,
  path: string,
  entries: Readonly<Record<string, string | undefined>>,
  options: { force: boolean },
): Promise<void> {
  const content = renderEntries(keys, entries)
  if (!options.force && existsSync(path)) throw existsError(path)
  const dir = dirname(path)
  ensureDirectory(dir, app)
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  const handle = await open(tmp, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    publish(tmp, path, options.force)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // temporary file already gone
    }
    throw error
  }
}
