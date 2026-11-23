/**
 * Drives a processor the way `run.ts` does, without a stream: wire chunks become canonical events
 * (`createWireReader`), each goes to `processor.event`, and the finish chunk's metadata reaches
 * `finish` as the framework turn result would carry it.
 */
import { createWireReader } from '@theokit/presenter'
import { readTurnMetadata, type WireChunk } from '@theokit/presenter/wire'

import {
  createHumanProcessor as human,
  createJsonlProcessor as jsonl,
  type ExecFinish,
  type ExecProcessor,
} from '../../src/runtime/events.js'
import type { ProcessorResult } from '../../src/runtime/events.js'

export interface WireDriven {
  process(chunk: WireChunk): void
  finish(status: 'finished' | 'error', extra?: ExecFinish): ProcessorResult
}

function drive(p: ExecProcessor): WireDriven {
  const reader = createWireReader()
  let meta: ReturnType<typeof readTurnMetadata>
  return {
    process(chunk) {
      meta = readTurnMetadata(chunk) ?? meta
      for (const event of reader.read(chunk)) p.event(event)
    },
    finish(status, extra) {
      return p.finish(status, {
        ...(meta?.usage === undefined ? {} : { usage: meta.usage }),
        ...(meta?.stopReason === undefined ? {} : { stopReason: meta.stopReason }),
        ...extra,
      })
    },
  }
}

export const createHumanProcessor = (...a: Parameters<typeof human>): WireDriven =>
  drive(human(...a))
export const createJsonlProcessor = (...a: Parameters<typeof jsonl>): WireDriven =>
  drive(jsonl(...a))
