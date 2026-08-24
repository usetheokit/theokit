// Drive one agent run against the running production server and report the
// client's wall clock plus the transcript of wire chunks.
const PORT = process.env.PORT ?? '3199'
const TRACEPARENT = process.env.TRACEPARENT // absent => no header sent at all
const SESSION = process.env.SESSION ?? `s-${Date.now()}`
const PATHNAME = process.env.PATHNAME ?? '/api/agents/chat'

const headers = { 'content-type': 'application/json', 'x-theo-action': '1' }
if (TRACEPARENT !== undefined && TRACEPARENT.length > 0) headers.traceparent = TRACEPARENT

const t0 = Date.now()
const res = await fetch(`http://127.0.0.1:${PORT}${PATHNAME}`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    message: process.env.MESSAGE ?? 'what time is it in Lisbon and in Sao Paulo?',
    sessionId: SESSION,
  }),
})
const text = await res.text()
const t1 = Date.now()

const chunks = []
for (const line of text.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) continue
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') continue
  try {
    chunks.push(JSON.parse(payload))
  } catch {
    chunks.push({ raw: payload })
  }
}

console.log(
  JSON.stringify(
    {
      status: res.status,
      sessionId: SESSION,
      sentTraceparent: TRACEPARENT ?? null,
      clientWallClockMs: t1 - t0,
      chunkTypes: chunks.map((c) => c.type ?? Object.keys(c)[0]),
      toolChunks: chunks
        .filter((c) => typeof c.type === 'string' && c.type.startsWith('tool-'))
        .map((c) => ({
          type: c.type,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          approvalId: c.approvalId,
        })),
      finish: chunks.find((c) => c.type === 'finish') ?? null,
      bodyHead: text.slice(0, 300),
    },
    null,
    2,
  ),
)
