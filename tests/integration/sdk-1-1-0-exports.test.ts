/**
 * T0.1 — SDK exports smoke (Phase 0).
 *
 * Contract verification: the Agent-Harness primitives the framework consumes
 * from @theokit/sdk are importable, structured, and instantiable. Promoted
 * from the v1.1.0 baseline to the v2.0.1 major (2026-06-19 dependency bump);
 * the surviving Harness surface (Agent / AgentRunError / ConversationStorage)
 * is unchanged across the major — only rag/voice/di sub-paths left the SDK.
 *
 * EC-4 (SHOULD TEST): use semver-aware major check (`^2.0.1`) instead of
 * brittle `starts-with` — accepts 2.x; rejects 1.x and 3.x.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  Agent,
  AgentRunError,
  type AgentRunErrorCode,
  FileSystemConversationStorage,
  InMemoryConversationStorage,
} from '@theokit/sdk'

/**
 * Minimal major-version check (`^2.0.1`).
 *  - major MUST equal 2 (every 2.x ships the Harness primitives this suite asserts)
 *  - minor/patch are free
 */
function satisfiesSdkMajor(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (m === null) return false
  return Number(m[1]) === 2
}

describe('SDK exports smoke (T0.1)', () => {
  it('test_sdk_version_satisfies_caret_range (EC-4) — @theokit/sdk version is in ^2.0.1', () => {
    // Resolve via require to find the actually-installed package.json
    const sdkPkgPath = require.resolve('@theokit/sdk/package.json')
    const pkg = JSON.parse(readFileSync(sdkPkgPath, 'utf8')) as { version: string }
    expect(satisfiesSdkMajor(pkg.version)).toBe(true)
  })

  it('test_agent_registry_has_configure_method — Agent.registry.configure is a function', () => {
    expect(typeof Agent.registry).toBe('object')
    expect(typeof Agent.registry.configure).toBe('function')
  })

  it('test_agent_run_error_has_code_field — instance carries code property', () => {
    const err = new AgentRunError('rate limited', {
      code: 'rate_limit' as AgentRunErrorCode,
      provider: 'openai',
      retriable: true,
    })
    expect(err.code).toBe('rate_limit')
    expect(err.provider).toBe('openai')
    expect(err.retriable).toBe(true)
  })

  it('test_file_system_conversation_storage_constructs — has getMessages/appendMessage/deleteConversation', () => {
    const s = new FileSystemConversationStorage()
    expect(typeof s.getMessages).toBe('function')
    expect(typeof s.appendMessage).toBe('function')
    expect(typeof s.deleteConversation).toBe('function')
  })

  it('test_in_memory_conversation_storage_constructs — same contract', () => {
    const s = new InMemoryConversationStorage()
    expect(typeof s.getMessages).toBe('function')
    expect(typeof s.appendMessage).toBe('function')
    expect(typeof s.deleteConversation).toBe('function')
  })

  it('major check rejects 1.x', () => {
    expect(satisfiesSdkMajor('1.99.99')).toBe(false)
  })

  it('major check rejects 3.0.0', () => {
    expect(satisfiesSdkMajor('3.0.0')).toBe(false)
  })

  it('major check accepts 2.0.1', () => {
    expect(satisfiesSdkMajor('2.0.1')).toBe(true)
  })

  it('major check accepts 2.99.99', () => {
    expect(satisfiesSdkMajor('2.99.99')).toBe(true)
  })

  it('major check rejects malformed string', () => {
    expect(satisfiesSdkMajor('not-a-version')).toBe(false)
    expect(satisfiesSdkMajor('')).toBe(false)
  })
})
