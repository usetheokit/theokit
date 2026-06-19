/**
 * Benchmark: Node.js vs Bun — HTTP request throughput.
 *
 * Run with:
 *   node --import tsx tests/benchmark/node-vs-bun.ts
 *   bun tests/benchmark/node-vs-bun.ts
 */
import 'reflect-metadata'
import { createDecoratorServer } from '../../src/bridge/create-server.js'
import { Controller, Get } from '../../src/decorators/index.js'

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

function detectRuntime(): string {
  if (typeof globalThis.Deno !== 'undefined') return 'Deno'
  if (typeof globalThis.Bun !== 'undefined') return 'Bun'
  return 'Node'
}
const runtime = detectRuntime()
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

function detectVersion(): string {
  const g = globalThis as {
    Deno?: { version: { deno: string } }
    Bun?: { version: string }
  }
  if (g.Deno) return g.Deno.version.deno
  if (g.Bun) return g.Bun.version
  return process.version
}
const version = detectVersion()
console.warn(`\n=== ${runtime} v${version} ===`)
console.warn(`  ${REQUESTS} requests in ${elapsed.toFixed(0)}ms`)
console.warn(`  ${rps} req/s`)
console.warn(`  ${(elapsed / REQUESTS).toFixed(2)} ms/req avg`)

server.close()
