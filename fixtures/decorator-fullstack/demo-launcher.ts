/**
 * Demo launcher — uses @swc/core to compile the demo.ts controller
 * (parameter decorators not supported by esbuild/tsx).
 *
 * Run: npx tsx fixtures/decorator-fullstack/demo-launcher.ts
 */
import { loadControllerWithSwc } from '../../packages/http-decorators/src/bridge/swc-loader.js'
import { createDecoratorServer } from '../../packages/http-decorators/src/bridge/create-server.js'
import { MiddlewareConsumerImpl } from '../../packages/http-decorators/src/bridge/middleware-consumer.js'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

// ─── Middleware (no parameter decorators — runs through tsx fine) ───

class LoggerMiddleware {
  use(req: IncomingMessage, _res: ServerResponse, next: () => void) {
    console.log(`  [MW] ${req.method} ${req.url}`)
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
  // Load controller via SWC (handles @Body/@Param/@Query parameter decorators)
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
╔══════════════════════════════════════════════════════════╗
║  TheoKit HTTP Decorators — Live Demo                    ║
║  NestJS-style: Middleware → Guards → Interceptors       ║
╠══════════════════════════════════════════════════════════╣
║                                                         ║
║  Server: http://localhost:${PORT}                          ║
║                                                         ║
║  Endpoints:                                             ║
║                                                         ║
║  GET  /api/v2/tasks              — list all             ║
║  GET  /api/v2/tasks/stats        — statistics           ║
║  GET  /api/v2/tasks/search?q=kit — search               ║
║  GET  /api/v2/tasks/1            — get by id            ║
║  POST /api/v2/tasks              — create (Zod)         ║
║  POST /api/v2/tasks/1/complete   — mark done            ║
║  DEL  /api/v2/tasks/3            — delete               ║
║                                                         ║
║  Features demonstrated:                                 ║
║    ✓ @Controller + @Get/@Post/@Delete                   ║
║    ✓ @Body(zodSchema) — Zod validation (422 on fail)    ║
║    ✓ @Param('id') + @Query('q')                         ║
║    ✓ @UseInterceptors(TimingInterceptor) — X-Resp-Time  ║
║    ✓ @UseGuards(AuthGuard) — /stats requires auth       ║
║    ✓ LoggerMiddleware (class) + corsMiddleware (fn)      ║
║    ✓ configure().forRoutes() route filtering             ║
║    ✓ SWC-powered controller loading (no esbuild limit)  ║
║                                                         ║
╚══════════════════════════════════════════════════════════╝

  curl localhost:${PORT}/api/v2/tasks
  curl -X POST localhost:${PORT}/api/v2/tasks -H "Content-Type: application/json" -d '{"title":"Hello","priority":"high"}'
  curl localhost:${PORT}/api/v2/tasks/search?q=hello
`)
  })
}

main().catch(console.error)
