// J9 re-measurement — a local Ollama-protocol model on 11434.
// The instrument J6 declared: `@theokit/sdk`'s `ollama` provider profile has
// authType "none" and speaks POST /api/chat NDJSON, so a scripted server on that
// port is a complete model as far as the framework is concerned. No key, no credits.
//
// STATELESS: the turn number is derived from how many tool results the request
// already carries, so repeated runs are byte-identical rather than depending on a
// process-level counter.
//
// SCRIPT:
//   two-tools : turn 1 calls current_time, turn 2 calls current_time again, turn 3 answers
//   gated     : turn 1 calls send_notification (HITL-gated), turn 2 answers
import http from 'node:http'

const SCRIPT = process.env.SCRIPT ?? 'two-tools'
const THINK_MS = Number(process.env.THINK_MS ?? '20')
const IN_TOKENS = Number(process.env.IN_TOKENS ?? '1200')
const OUT_TOKENS = Number(process.env.OUT_TOKENS ?? '340')

function toolTurn(name, args) {
  return [
    {
      model: 'j9-local',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name, arguments: args } }],
      },
      done: false,
    },
    {
      model: 'j9-local',
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: IN_TOKENS,
      eval_count: OUT_TOKENS,
    },
  ]
}

function textTurn(text) {
  return [
    { model: 'j9-local', message: { role: 'assistant', content: text }, done: false },
    {
      model: 'j9-local',
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: IN_TOKENS,
      eval_count: OUT_TOKENS,
    },
  ]
}

function scriptFor(n) {
  if (SCRIPT === 'gated') {
    if (n === 1) return toolTurn('send_notification', { message: 'the order shipped' })
    return textTurn('Done - the notification was sent.')
  }
  if (n === 1) return toolTurn('current_time', { timezone: 'Europe/Lisbon' })
  if (n === 2) return toolTurn('current_time', { timezone: 'America/Sao_Paulo' })
  return textTurn('Lisbon and Sao Paulo times above.')
}

/**
 * How many tool results the request already carries — which IS the turn number, since
 * this model is stateless on purpose so repeated runs are byte-identical.
 *
 * A body that does not parse is reported rather than swallowed: it means the framework
 * sent something this instrument does not understand, and a silent 0 would answer turn 1
 * forever and look like a model that never advances.
 */
function countPriorToolResults(body) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    console.error('model: request body is not JSON —', String(error))
    return 0
  }
  return (parsed.messages ?? []).filter((m) => m.role === 'tool').length
}

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/api/tags') || req.url?.startsWith('/v1/models')) {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ models: [{ name: 'j9-local' }] }))
    return
  }
  if (!req.url?.startsWith('/api/chat')) {
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    const priorToolResults = countPriorToolResults(body)
    const turn = priorToolResults + 1
    const chunks = scriptFor(turn)
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    for (const c of chunks) {
      await new Promise((r) => setTimeout(r, THINK_MS))
      res.write(JSON.stringify(c) + '\n')
    }
    res.end()
  })
})
server.listen(Number(process.env.MODEL_PORT ?? '11434'), '127.0.0.1', () =>
  console.log(`model on 11434 script=${SCRIPT} (stateless)`),
)
