import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { untrustedContentSendOptions } from '../src/agent/untrusted-content.js'

const SRC = join(import.meta.dirname, '..', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('the untrusted content options are the agent default, not a per-send option', () => {
  it('every agent carries them as sendDefaults', () => {
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'k' })

    expect(options.sendDefaults).toEqual(untrustedContentSendOptions())
    expect(options.sendDefaults?.toolResultGuard).toEqual({ delimit: true })
  })

  it('no file in src calls untrustedContentSendOptions() except create-agent', () => {
    const callers = sourceFiles(SRC)
      .filter((path) => /untrustedContentSendOptions\(\)/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))
      .filter((file) => file !== 'agent/untrusted-content.ts')

    expect(callers).toEqual(['agent/create-agent.ts'])
  })
})
