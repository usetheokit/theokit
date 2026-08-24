// J9 re-measurement — local OTLP/JSON collector.
// Accepts POST /v1/traces, appends every received span to a JSONL file.
import http from 'node:http'
import fs from 'node:fs'

// The output path is REQUIRED rather than defaulted. A default under a world-writable
// directory is a file any local user can pre-create and win a race on, and the evidence
// of a measurement is exactly the file you do not want another process to own.
const OUT = process.argv[2]
if (OUT === undefined) {
  console.error('usage: node collector.mjs <out.jsonl>')
  process.exit(2)
}
fs.writeFileSync(OUT, '')

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const at = Date.now()
    try {
      const parsed = JSON.parse(body)
      for (const rs of parsed.resourceSpans ?? []) {
        for (const ss of rs.scopeSpans ?? []) {
          for (const span of ss.spans ?? []) {
            fs.appendFileSync(OUT, JSON.stringify({ receivedAt: at, url: req.url, span }) + '\n')
          }
        }
      }
    } catch (e) {
      fs.appendFileSync(
        OUT,
        JSON.stringify({
          receivedAt: at,
          url: req.url,
          parseError: String(e),
          raw: body.slice(0, 4000),
        }) + '\n',
      )
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"partialSuccess":{}}')
  })
})
server.listen(4318, '127.0.0.1', () => console.log('collector on 4318 ->', OUT))
