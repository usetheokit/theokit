/**
 * The roster and helpers the handoff conversation suites share (B-410). Import it only from a test
 * file that mocks `src/bridge/sdk-adapter.js` with `./handoff-sdk-fake.js`: this module loads the
 * handoff module, and with it the adapter.
 */
import { expect } from 'vitest'

import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { createHandoffConversation, HandoffError } from '../../src/handoff/handoff-conversation.js'

import { h } from './handoff-sdk-fake.js'

const base = applyCapabilities([new ModelCapability('test-model')])

export function agent(name: string, maxIterations?: number) {
  const marker = {
    name: `${name}_marker`,
    description: `marks ${name}`,
    inputSchema: {},
    handler: () => name,
  }
  return {
    name,
    compiled: { ...base, tools: [marker] },
    ...(maxIterations === undefined ? {} : { maxIterations }),
  }
}

export const ROSTER = [agent('triage'), agent('billing'), agent('refunds')]

export function conversation() {
  h.calls.length = 0
  h.scripts.length = 0
  return createHandoffConversation({ agents: ROSTER, initial: 'triage', conversationId: 'conv-1' })
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
}

export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(HandoffError)
    return (error as HandoffError).code
  }
  return undefined
}

export async function rejectionOf(start: () => Promise<unknown>): Promise<unknown> {
  try {
    await start()
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

/** The paragraph a message opens with, which is where the receiver reads the note. */
export function leadOf(message: string): string {
  return message.split('\n\n')[0] ?? ''
}

export const OPTS = { apiKey: 'k' }
