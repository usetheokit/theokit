/**
 * TheoKit HTTP Decorators — Complete NestJS Pipeline Demo
 *
 * Run: npx tsx fixtures/decorator-fullstack/demo-launcher.ts
 *
 * The controller is loaded via SWC (not esbuild) because parameter
 * decorators (@Body, @Param, @Query) require SWC's legacyDecorator support.
 */
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { loadControllerWithSwc } from '../../packages/http-decorators/src/bridge/swc-loader.js'
import { createDecoratorServer } from '../../packages/http-decorators/src/bridge/create-server.js'

// ─── Middleware (no parameter decorators — tsx/esbuild handles fine) ───

class LoggerMiddleware {
  use(req: IncomingMessage, _res: ServerResponse, next: () => void) {
    const time = new Date().toLocaleTimeString()
    console.log(`  [${time}] ${req.method} ${req.url}`)
    next()
  }
}

function corsMiddleware(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('X-Powered-By', 'TheoKit HTTP Decorators')
  next()
}

// ─── Main ───

async function main() {
  // Load controller via SWC — handles @Body/@Param/@Query parameter decorators
  const controllerPath = resolve(import.meta.dirname!, 'server/controllers/tasks.controller.ts')
  const mod = await loadControllerWithSwc(controllerPath)
  const TasksController = mod.TasksController as Function

  const PORT = 4000

  const server = createDecoratorServer({
    controllers: [TasksController],
    configure(consumer) {
      consumer.apply(corsMiddleware).forRoutes('*')
      consumer.apply(LoggerMiddleware).forRoutes('api/v2/tasks')
    },
  })

  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  TheoKit HTTP Decorators — Complete NestJS Pipeline Demo         ║
║  Middleware → Guards → Interceptors → Handler → Exception Filters║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Server: http://localhost:${PORT}                                   ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ ENDPOINTS                                                 │  ║
║  │  GET  /api/v2/tasks              — list all               │  ║
║  │  GET  /api/v2/tasks/stats        — statistics             │  ║
║  │  GET  /api/v2/tasks/search?q=doc — search                 │  ║
║  │  GET  /api/v2/tasks/1            — get by id              │  ║
║  │  POST /api/v2/tasks              — create (Zod validated) │  ║
║  │  POST /api/v2/tasks/1/complete   — mark done              │  ║
║  │  DEL  /api/v2/tasks/3            — delete                 │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ ERROR HANDLING                                            │  ║
║  │  GET  /api/v2/tasks/999  — 404 NotFoundException          │  ║
║  │  POST {"title":"a"}      — 422 Zod validation             │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  PIPELINE:                                                       ║
║    ✓ @Controller + @Get/@Post/@Delete + @HttpCode                ║
║    ✓ @Body(zodSchema) + @Param('id') + @Query('q')              ║
║    ✓ @UseInterceptors(TimingInterceptor) — X-Response-Time       ║
║    ✓ LoggerMiddleware (class) + corsMiddleware (functional)       ║
║    ✓ configure().forRoutes() middleware route filtering           ║
║    ✓ NotFoundException → 404 typed JSON response                 ║
║    ✓ Exception filter pipeline with global fallback              ║
║    ✓ SWC-powered controller loading                              ║
║                                                                  ║
╚═══════════════════════════════════════════════════════════════════╝

  curl localhost:${PORT}/api/v2/tasks
  curl localhost:${PORT}/api/v2/tasks/999
  curl localhost:${PORT}/api/v2/tasks/search?q=doc
  curl -X POST localhost:${PORT}/api/v2/tasks -H "Content-Type: application/json" -d '{"title":"Hello","priority":"high"}'
  curl -X POST localhost:${PORT}/api/v2/tasks -H "Content-Type: application/json" -d '{"title":"a"}'
`)
  })
}

main().catch(console.error)
