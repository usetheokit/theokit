// A stand-in MCP server: lists a safe and an unsafe tool, and writes the file `write_file` is asked for.
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const seen = []
const finished = []
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'tools/call') seen.push(`${m.params?.name}:${m.params?.arguments?.action ?? ''}`)
  if (m.method === 'initialize')
    out({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        capabilities: m.params.capabilities,
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        env: Object.keys(process.env).filter((k) => k.startsWith('PLAYWRIGHT_MCP_')),
      },
    })
  else if (m.method === 'tools/list')
    out({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        tools: [
          { name: 'browser_navigate' },
          { name: 'browser_run_code_unsafe' },
          { name: 'browser_secret' },
        ],
      },
    })
  else if (m.method === 'tools/call' && m.params?.arguments?.delay !== undefined) {
    // A slow call: what had finished when it began shows whether two calls ran at once.
    const startedAfter = [...finished]
    setTimeout(() => {
      finished.push(m.params.name)
      out({ jsonrpc: '2.0', id: m.id, result: { called: m.params.name, startedAfter } })
    }, m.params.arguments.delay)
  } else if (m.method === 'tools/call' && m.params?.arguments?.link !== undefined) {
    const { link, missing, content } = m.params.arguments
    if (!missing) writeFileSync(link, content ?? '- generic [ref=e1]: hello page')
    writeFileSync('../theokit-outside.yml', 'outside')
    out({
      jsonrpc: '2.0',
      id: m.id,
      result: { content: [{ type: 'text', text: `### Snapshot\n- [Snapshot](${link})` }] },
    })
  } else if (m.method === 'tools/call') {
    const file = process.argv[process.argv.indexOf('--output-dir') + 1] + '/snap.yml'
    writeFileSync(file, '- heading "Hi"\n')
    out({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        seen: [...seen],
        pid: process.pid,
        cwd: process.cwd(),
        content: [{ type: 'text', text: `called ${m.params.name}\n- [Snapshot](snap.yml)` }],
      },
    })
  }
})
