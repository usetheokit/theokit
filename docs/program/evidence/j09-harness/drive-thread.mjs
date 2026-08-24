// Exercise the THREAD route (criterion 6's third path, usetheokit/theokit#381).
// POST /api/agents/chat/threads/<sessionId>/message answers 202 and the run streams
// headlessly, so the spans arrive without the request being open.
const PORT = process.env.PORT ?? '3199'
const TRACEPARENT = process.env.TRACEPARENT
const SESSION = process.env.SESSION ?? `thread-${Date.now()}`

const headers = { 'content-type': 'application/json', 'x-theo-action': '1' }
if (TRACEPARENT !== undefined && TRACEPARENT.length > 0) headers.traceparent = TRACEPARENT

const t0 = Date.now()
const res = await fetch(`http://127.0.0.1:${PORT}/api/agents/chat/threads/${SESSION}/message`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ message: 'what time is it in Lisbon and in Sao Paulo?' }),
})
const body = await res.text()
console.log(
  JSON.stringify(
    {
      status: res.status,
      wallMs: Date.now() - t0,
      sentTraceparent: TRACEPARENT ?? null,
      body: body.slice(0, 400),
    },
    null,
    2,
  ),
)
