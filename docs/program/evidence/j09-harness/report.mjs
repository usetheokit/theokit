// Render the collector's JSONL as a readable span table.
import fs from 'node:fs'
const FILE = process.argv[2]
const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean)
const attrValue = (v) =>
  v.stringValue ??
  (v.intValue !== undefined ? `int:${v.intValue}` : undefined) ??
  (v.doubleValue !== undefined ? `dbl:${v.doubleValue}` : undefined) ??
  (v.boolValue !== undefined ? `bool:${v.boolValue}` : undefined)
for (const l of lines) {
  const r = JSON.parse(l)
  if (r.parseError) {
    console.log('PARSE ERROR', r.parseError, r.raw?.slice(0, 200))
    continue
  }
  const s = r.span
  const dur = (Number(s.endTimeUnixNano) - Number(s.startTimeUnixNano)) / 1e6
  const attrs = s.attributes.map((a) => `${a.key}=${attrValue(a.value)}`).join(' ')
  console.log(
    `${s.name.padEnd(12)} trace=${s.traceId} id=${s.spanId} parent=${s.parentSpanId ?? '-'.repeat(16)} dur=${dur.toFixed(3)}ms status=${s.status.code}${s.status.message ? ' msg=' + s.status.message : ''}`,
  )
  console.log(`             ${attrs}`)
}
console.log(
  `\n${lines.length} spans; distinct traces: ${new Set(lines.map((l) => JSON.parse(l).span?.traceId)).size}`,
)
