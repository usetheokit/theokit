/**
 * TheoKit HTTP Decorators — Full NestJS Pipeline Demo
 *
 * Demonstrates the COMPLETE NestJS-compatible pipeline:
 *   Middleware → Guards → Interceptors → Handler → Exception Filters
 *
 * Run: npx tsx fixtures/decorator-fullstack/demo-launcher.ts
 */
import { loadControllerWithSwc } from '../../packages/http-decorators/src/bridge/swc-loader.js'
import { createDecoratorServer } from '../../packages/http-decorators/src/bridge/create-server.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'

// ─── Middleware ───

class LoggerMiddleware {
  use(req: IncomingMessage, _res: ServerResponse, next: () => void) {
    const time = new Date().toLocaleTimeString()
    console.log(`  [${time}] ${req.method} ${req.url}`)
    next()
  }
}

function corsMiddleware(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('X-Powered-By', 'TheoKit Decorators')
  next()
}

// ─── Main ───

async function main() {
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
╔══════════════════════════════════════════════════════════════╗
║  TheoKit HTTP Decorators — Full NestJS Pipeline Demo        ║
║  Middleware → Guards → Interceptors → Handler → Filters     ║
╠══════════════════════════════════════════════════════════════╣
║                                                             ║
║  Server: http://localhost:${PORT}                              ║
║                                                             ║
║  ┌─────────────────────────────────────────────────────┐    ║
║  │ CRUD                                                │    ║
║  │  GET  /api/v2/tasks            — list all           │    ║
║  │  GET  /api/v2/tasks/stats      — statistics         │    ║
║  │  GET  /api/v2/tasks/search?q=  — search             │    ║
║  │  GET  /api/v2/tasks/1          — get by id          │    ║
║  │  POST /api/v2/tasks            — create (Zod)       │    ║
║  │  POST /api/v2/tasks/1/complete — mark done          │    ║
║  │  DEL  /api/v2/tasks/3          — delete             │    ║
║  └─────────────────────────────────────────────────────┘    ║
║                                                             ║
║  ┌─────────────────────────────────────────────────────┐    ║
║  │ Error Handling (Exception Filters)                  │    ║
║  │  GET  /api/v2/tasks/999        — 404 NotFoundException│  ║
║  │  POST /api/v2/tasks {title:"a"} — 422 Zod validation │  ║
║  └─────────────────────────────────────────────────────┘    ║
║                                                             ║
║  Pipeline features:                                         ║
║    ✓ @Controller + @Get/@Post/@Delete decorators            ║
║    ✓ @Body(zodSchema) — Zod validation → 422               ║
║    ✓ @Param('id') + @Query('q') parameter decorators        ║
║    ✓ @UseInterceptors(TimingInterceptor) — X-Response-Time  ║
║    ✓ LoggerMiddleware (class) + corsMiddleware (functional)  ║
║    ✓ configure().forRoutes() route filtering                 ║
║    ✓ NotFoundException → 404 {error:{code,message}}         ║
║    ✓ Exception filter pipeline with global fallback          ║
║    ✓ SWC-powered controller loading                          ║
║                                                             ║
╚══════════════════════════════════════════════════════════════╝

  Try:
    curl localhost:${PORT}/api/v2/tasks
    curl localhost:${PORT}/api/v2/tasks/999
    curl -X POST localhost:${PORT}/api/v2/tasks -H "Content-Type: application/json" -d '{"title":"Hello","priority":"high"}'
    curl -X POST localhost:${PORT}/api/v2/tasks -H "Content-Type: application/json" -d '{"title":"a"}'
`)
  })
}

main().catch(console.error)
