import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import {
  LocalSandbox,
  SandboxBackend,
  shellEscapePosix,
  type SandboxNetworkPolicy,
} from '../../src/sandbox-entry.js'

/**
 * A custom backend (a VM or a container) had nowhere to say what it can reach, no lifecycle to stop
 * it, and no way to quote an argument outside a subclass (usetheokit/theokit#1130 and #1131). The
 * SDK added all three in 5.13; this subpath is how a consumer of the layer reaches them.
 */
class FakeVm extends SandboxBackend {
  stopped = 0
  readonly networkPolicy: SandboxNetworkPolicy = { mode: 'allowlist', allow: ['github.com'] }
  async execute() {
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false }
  }
  async uploadFile() {}
  override async dispose() {
    this.stopped += 1
  }
}

describe('shellEscapePosix from the sandbox subpath', () => {
  it('test_a_hostile_argument_reaches_the_shell_as_one_literal_word', () => {
    const hostile = `it's $(echo pwned) \`id\` ; rm -rf / "x"\n-leading-dash`
    const echoed = execFileSync('/bin/sh', ['-c', `printf %s ${shellEscapePosix(hostile)}`], {
      encoding: 'utf8',
    })
    expect(echoed).toBe(hostile)
  })
})

describe('SandboxBackend lifecycle and egress', () => {
  it('test_a_backend_that_does_not_override_dispose_can_be_disposed_twice', async () => {
    const backend = new LocalSandbox()
    await expect(backend.dispose()).resolves.toBeUndefined()
    await expect(backend.dispose()).resolves.toBeUndefined()
  })

  it('test_a_backend_that_overrides_dispose_is_the_one_called', async () => {
    const vm = new FakeVm()
    await vm.dispose()
    expect(vm.stopped).toBe(1)
  })

  it('test_a_backend_states_its_egress_and_local_says_it_is_unrestricted', () => {
    expect(new FakeVm().networkPolicy).toEqual({ mode: 'allowlist', allow: ['github.com'] })
    expect(new LocalSandbox().networkPolicy).toEqual({ mode: 'unrestricted' })
  })
})
