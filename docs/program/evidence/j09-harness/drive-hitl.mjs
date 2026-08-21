// Drive one HITL-gated run against the production server, streaming the SSE body,
// and answer the approval after a KNOWN delay so criterion 3 has a human wait to
// compare a pause span against.
const PORT = process.env.PORT ?? '3199'
const TRACEPARENT = process.env.TRACEPARENT
const HUMAN_DELAY_MS = Number(process.env.HUMAN_DELAY_MS ?? '1200')
const SESSION = process.env.SESSION ?? `hitl-${Date.now()}`

const headers = { 'content-type': 'application/json', 'x-theo-action': '1' }
if (TRACEPARENT !== undefined && TRACEPARENT.length > 0) headers.traceparent = TRACEPARENT

const events = []
const t0 = Date.now()
const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ message: 'notify me that the order shipped', sessionId: SESSION }),
})

let approvalAnswered = null
let approvalSeenAt = null
const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''

async function answer(approvalId) {
  approvalSeenAt = Date.now()
  await new Promise((r) => setTimeout(r, HUMAN_DELAY_MS))
  const t = Date.now()
  const r = await fetch(`http://127.0.0.1:${PORT}/api/agents/chat/approve/${approvalId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ approved: true }),
  })
  approvalAnswered = {
    at: t,
    status: r.status,
    body: (await r.text()).slice(0, 200),
    delayMs: t - approvalSeenAt,
  }
}

let pending = null
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const p = t.slice(5).trim()
    if (p === '[DONE]') continue
    let c
    try {
      c = JSON.parse(p)
    } catch {
      continue
    }
    events.push({ atMs: Date.now() - t0, ...c })
    if (c.type === 'tool-approval-request' && pending === null) pending = answer(c.approvalId)
  }
}
if (pending !== null) await pending
const t1 = Date.now()

console.log(
  JSON.stringify(
    {
      status: res.status,
      sessionId: SESSION,
      clientWallClockMs: t1 - t0,
      humanDelayMs: HUMAN_DELAY_MS,
      approvalAnswered,
      events: events.map((e) => ({
        atMs: e.atMs,
        type: e.type,
        toolCallId: e.toolCallId,
        approvalId: e.approvalId,
        toolName: e.toolName,
        messageMetadata: e.messageMetadata,
      })),
    },
    null,
    2,
  ),
)
