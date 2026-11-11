import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'

/**
 * OC-87: standing orders, kept in `STANDING-ORDERS.md` in the workspace, one `- order` line each.
 * The file is one of the persona files (`PERSONA_FILES`), so every new chat session of the agent
 * gets it in its system prompt until the owner removes the line.
 */
export const STANDING_ORDERS_FILE = 'STANDING-ORDERS.md'

const USAGE = 'theoclaw orders: expected add <text> | list | remove <number>'

export interface OrdersIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
}

/** The workspace the same way onboarding defaults it: `THEOCLAW_WORKSPACE`, else the XDG data directory. */
function workspaceOf(io: OrdersIo): string {
  const set = (io.env.THEOCLAW_WORKSPACE ?? '').trim()
  if (set !== '') return set
  const data = io.env.XDG_DATA_HOME?.trim() || join(io.homeDir, '.local', 'share')
  return join(data, 'theoclaw', 'workspace')
}

function readOrders(file: string): string[] {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line !== '')
}

function writeOrders(workspace: string, file: string, orders: readonly string[]): void {
  mkdirSync(workspace, { recursive: true })
  writeFileSync(file, orders.map((order) => `- ${order}\n`).join(''))
}

export function ordersCommand(args: readonly string[], io: OrdersIo): number {
  const [verb, ...rest] = args
  const workspace = workspaceOf(io)
  const file = join(workspace, STANDING_ORDERS_FILE)
  const orders = readOrders(file)
  if (verb === 'list') {
    if (rest.length > 0) throw new UsageError(USAGE)
    orders.forEach((order, index) => io.stdout.write(`${index + 1}. ${order}\n`))
    if (orders.length === 0) io.stdout.write('no standing orders\n')
    return 0
  }
  if (verb === 'add') {
    const text = rest.join(' ').replace(/\s+/g, ' ').trim()
    if (text === '') throw new UsageError(USAGE)
    writeOrders(workspace, file, [...orders, text])
    io.stdout.write(`added standing order ${orders.length + 1}\n`)
    return 0
  }
  if (verb === 'remove') {
    const number = rest.length === 1 && /^\d+$/.test(rest[0] ?? '') ? Number(rest[0]) : 0
    if (number < 1) throw new UsageError(USAGE)
    if (number > orders.length) throw new UsageError(`theoclaw orders: there is no standing order ${number}`)
    writeOrders(workspace, file, orders.filter((_, index) => index !== number - 1))
    io.stdout.write(`removed standing order ${number}\n`)
    return 0
  }
  throw new UsageError(USAGE)
}
