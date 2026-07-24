import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'

// ─── File Edit Stream Event ─────────────────────────────────

describe('FileEditEvent stream type', () => {
  it('test_search_replace_event', () => {
    const event: AgentStreamEvent = {
      type: 'file_edit',
      file: 'src/app.ts',
      format: 'search-replace',
      search: 'const x = 1',
      replace: 'const x = 2',
    }
    expect(event.type).toBe('file_edit')
  })

  it('test_full_file_event', () => {
    const event: AgentStreamEvent = {
      type: 'file_edit',
      file: 'src/new-file.ts',
      format: 'full-file',
      content: 'export const hello = "world"',
    }
    expect(event.type).toBe('file_edit')
  })

  it('test_unified_diff_event', () => {
    const event: AgentStreamEvent = {
      type: 'file_edit',
      file: 'src/app.ts',
      format: 'unified-diff',
      diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
    }
    expect(event.type).toBe('file_edit')
  })

  it('test_all_14_event_types', () => {
    const events: AgentStreamEvent[] = [
      { type: 'run_started', runId: 'r', agentName: 'a' },
      { type: 'text_delta', content: '' },
      { type: 'tool_call', callId: 'c', toolName: 't', input: {} },
      {
        type: 'tool_result',
        callId: 'c',
        toolName: 't',
        output: '',
        durationMs: 0,
        isError: false,
      },
      { type: 'thinking', content: '' },
      { type: 'iteration', step: 1, totalSteps: null },
      {
        type: 'approval_required',
        callId: 'c',
        toolName: 't',
        question: 'q',
        callbackUrl: 'u',
        timeoutMs: 0,
      },
      { type: 'artifact_start', artifactId: 'a', mimeType: 'm' },
      { type: 'artifact_chunk', artifactId: 'a', chunk: '', isLast: true },
      { type: 'state_update', channel: 'c', data: {} },
      { type: 'checkpoint_saved', checkpointId: 'c', step: 0, resumeToken: 't' },
      { type: 'file_edit', file: 'f', format: 'full-file', content: '' },
      { type: 'error', code: 'E', message: 'm', retryable: false },
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 0,
      },
    ]
    expect(events).toHaveLength(14)
    expect(new Set(events.map((e) => e.type)).size).toBe(14)
  })
})
