import 'reflect-metadata'

import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { startChannelLoop } from '../src/channels/channel-loop.js'
import type { ChannelLoop } from '../src/channels/channel-loop.js'
import { resolvePlatforms } from '../src/channels/platforms.js'
import { waitFor } from './fakes.js'

let loop: ChannelLoop | undefined
afterEach(async () => {
  await loop?.stopAll()
  loop = undefined
})

/**
 * A stand-in for the `raft` CLI, run as a real child process: `wake --json` prints one wake and
 * stays up; `reply --to <id>` appends the id and its stdin to a file.
 */
function fakeRaftCli(): { readonly path: string; readonly replies: () => string } {
  const dir = mkdtempSync(join(tmpdir(), 'raft-'))
  const path = join(dir, 'raft')
  const out = join(dir, 'replies.txt')
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "wake" ]; then
  echo '{"id":"w1","from":"alice","text":"hello","conversation":"room-7"}'
  exec sleep 30
fi
if [ "$1" = "reply" ]; then
  { echo "to=$3"; cat; echo; } >> "${out}"
fi
`,
  )
  chmodSync(path, 0o755)
  return { path, replies: () => { try { return readFileSync(out, 'utf8') } catch { return '' } } }
}

describe('raft', () => {
  it('runs only when enabled, with no secret to mask', () => {
    expect(resolvePlatforms({}).configured.map((entry) => entry.platform)).not.toContain('raft')
    expect(resolvePlatforms({}).skipped).toContainEqual({ platform: 'raft', missing: ['THEOCLAW_RAFT_ENABLED'] })
    const resolved = resolvePlatforms({ THEOCLAW_RAFT_ENABLED: '1' })
    expect(resolved.configured).toEqual([{ platform: 'raft', settings: {} }])
    expect(resolved.secrets).toEqual([])
    expect(resolvePlatforms({ THEOCLAW_RAFT_ENABLED: '1', THEOCLAW_RAFT_CLI_PATH: ' /bin/raft ' }).configured).toEqual([
      { platform: 'raft', settings: { command: '/bin/raft' } },
    ])
  })

  it('replies in Raft to an agent woken from Raft', async () => {
    const cli = fakeRaftCli()
    const resolved = resolvePlatforms({ THEOCLAW_RAFT_ENABLED: '1', THEOCLAW_RAFT_CLI_PATH: cli.path })
    loop = startChannelLoop({
      platforms: adapterBuilders(resolved.configured),
      handler: async (event, ctx) => void (await ctx.reply(`echo: ${event.text}`)),
      secrets: resolved.secrets,
      write: () => undefined,
    })
    await loop.ready
    expect(loop.failed).toEqual([])

    await waitFor(() => cli.replies().includes('echo: hello'), 5000, 'the reply through `raft reply`')
    expect(cli.replies()).toContain('to=room-7')
  })
})
