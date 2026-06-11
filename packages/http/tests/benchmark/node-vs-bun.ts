/**
 * Benchmark: Node.js vs Bun — HTTP request throughput.
 *
 * Run with:
 *   node --import tsx tests/benchmark/node-vs-bun.ts
 *   bun tests/benchmark/node-vs-bun.ts
 */
import 'reflect-metadata'
import { Controller, Get } from '../../src/decorators/index.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'

@Controller('bench')
class BenchController {
  @Get()
  hello() {
    return { message: 'hello', timestamp: Date.now() }
  }
}

const server = createDecoratorServer([BenchController])

await new Promise<void>((resolve) => {
  server.listen(0, resolve)
})
const port = (server.address() as { port: number }).port
const url = `http://localhost:${port}/bench`

const runtime = typeof globalThis.Deno !== 'undefined' ? 'Deno' : typeof globalThis.Bun !== 'undefined' ? 'Bun' : 'Node'
const WARMUP = 100
const REQUESTS = 2000

// Warmup
for (let i = 0; i < WARMUP; i++) {
  await fetch(url)
}

// Benchmark
const start = performance.now()
for (let i = 0; i < REQUESTS; i++) {
  const res = await fetch(url)
  await res.text() // consume body
}
const elapsed = performance.now() - start
const rps = Math.round((REQUESTS / elapsed) * 1000)

const version = typeof globalThis.Deno !== 'undefined' ? Deno.version.deno : typeof globalThis.Bun !== 'undefined' ? Bun.version : process.version
console.log(`\n=== ${runtime} v${version} ===`)
console.log(`  ${REQUESTS} requests in ${elapsed.toFixed(0)}ms`)
console.log(`  ${rps} req/s`)
console.log(`  ${(elapsed / REQUESTS).toFixed(2)} ms/req avg`)

server.close()
