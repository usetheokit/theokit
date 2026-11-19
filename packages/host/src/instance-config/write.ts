import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
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

export async function writeInstanceConfig(
  app: string,
  keys: Readonly<Record<string, InstanceKey>>,
  path: string,
  entries: Readonly<Record<string, string | undefined>>,
  options: { force: boolean },
): Promise<void> {
  const lines: string[] = []
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue
    if (!Object.hasOwn(keys, key) || !KEY.test(key)) {
      throw new InstanceConfigError('instance_config_unknown_key', `${key} is not a declared key`)
    }
    assertWritable(key, value)
    const parse = keys[key].parse
    if (parse !== undefined) {
      try {
        parse(value)
      } catch (error) {
        throw new InstanceConfigError(
          'instance_config_invalid_value',
          `the value of ${key} was refused by its parser`,
          {
            cause: error,
          },
        )
      }
    }
    lines.push(`${key}="${value}"`)
  }
  if (!options.force && existsSync(path)) {
    throw new InstanceConfigError(
      'instance_config_exists',
      `${path} already exists; pass force to replace it`,
    )
  }
  const dir = dirname(path)
  ensureDirectory(dir, app)
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  const handle = await open(tmp, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(`${lines.join('\n')}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (options.force) {
      renameSync(tmp, path)
    } else {
      // link fails with EEXIST when a concurrent writer got there first.
      try {
        linkSync(tmp, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new InstanceConfigError(
            'instance_config_exists',
            `${path} already exists; pass force to replace it`,
          )
        }
        throw error
      }
      unlinkSync(tmp)
    }
  } catch (error) {
    try {
      lstatSync(tmp)
      unlinkSync(tmp)
    } catch {
      // temporary file already gone
    }
    throw error
  }
}
