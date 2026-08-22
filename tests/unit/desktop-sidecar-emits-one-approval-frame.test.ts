/**
 * The scaffolded desktop sidecar must not hand-write a second approval frame
 * (usetheokit/theokit#403).
 *
 * `runTurnToJsonl` streams whatever `streamAgentTurnInProcess` produces, and a gated tool produces
 * the real `tool-approval-request` — carrying the `toolCallId` the wire schema requires. The
 * template's own `awaitApproval` callback then wrote a SECOND line by hand, shaped
 * `{ type, approvalId, toolName }`, which that schema refuses.
 *
 * It was inert rather than broken: `ChannelTransport` parses pushed lines with a bare `JSON.parse`
 * and no validation, and `readMessageStream` drops an approval naming a call it never saw. What it
 * cost is that the file a new desktop app is generated from taught a frame shape the framework
 * rejects — and a future reader that DOES validate, or that keys approvals by `approvalId` rather
 * than `toolCallId`, would inherit a duplicate with no rule for it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { wireChunkSchema } from '../../packages/presenter/src/wire/chunk-schema.js'

const SIDECAR = resolve(
  __dirname,
  '../../packages/create-theokit/templates/surfaces/desktop/sidecar/sidecar.ts',
)

describe('the scaffolded desktop sidecar (#403)', () => {
  it('does not write a tool-approval-request of its own', () => {
    const source = readFileSync(SIDECAR, 'utf8')

    // The frame exists on the wire already. Emitting it here is a duplicate by construction,
    // because the same callback runs INSIDE the turn whose chunks `runTurnToJsonl` is writing.
    expect(source).not.toMatch(/write\([^)]*tool-approval-request/su)
  })

  it('still registers the pending resolver, so the gate can be settled', () => {
    // The counter-proof: removing the write must not remove the callback. Without the `pending`
    // entry the Rust shell's forwarded decision has nothing to resolve and the gate hangs until
    // its timeout.
    const source = readFileSync(SIDECAR, 'utf8')

    expect(source).toMatch(/pending\.set\(approvalId, resolve\)/u)
  })

  it("the shape it used to write is one the framework's own schema refuses", () => {
    // Why the duplicate mattered even while nothing read it: `toolCallId` is required, and it is
    // what every reader keys a tool part by.
    const handWritten = {
      type: 'tool-approval-request',
      approvalId: 'a1',
      toolName: 'send_email',
    }

    expect(wireChunkSchema.safeParse(handWritten).success).toBe(false)
    expect(wireChunkSchema.safeParse({ ...handWritten, toolCallId: 'c1' }).success).toBe(true)
  })
})
