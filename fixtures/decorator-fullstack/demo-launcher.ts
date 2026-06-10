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
║  │ ENDPOINTS                        AUTH                     │  ║
║  │  GET  /api/v2/tasks              — @IsPublic              │  ║
║  │  GET  /api/v2/tasks/stats        — @IsPublic              │  ║
║  │  GET  /api/v2/tasks/search?q=doc — @IsPublic              │  ║
║  │  GET  /api/v2/tasks/1            — @IsPublic              │  ║
║  │  POST /api/v2/tasks              — @Roles([User]) + Zod   │  ║
║  │  POST /api/v2/tasks/1/complete   — @Roles([User])         │  ║
║  │  DEL  /api/v2/tasks/3            — @Roles([Admin])        │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ AUTH TESTING                                              │  ║
║  │  POST without x-role    → 403 Forbidden                   │  ║
║  │  POST x-role: user      → 201 Created                     │  ║
║  │  DEL  x-role: user      → 403 Forbidden (needs admin)     │  ║
║  │  DEL  x-role: admin     → 204 Deleted                     │  ║
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
║    ✓ @Roles + @IsPublic + RolesGuard (RBAC authorization)        ║
║    ✓ @Body(zodSchema) + @Param('id') + @Query('q')              ║
║    ✓ @UseInterceptors(TimingInterceptor) — X-Response-Time       ║
║    ✓ LoggerMiddleware (class) + corsMiddleware (functional)       ║
║    ✓ configure().forRoutes() middleware route filtering           ║
║    ✓ NotFoundException → 404 typed JSON response                 ║
║    ✓ Exception filter pipeline with global fallback              ║
║    ✓ ExecutionContext + Reflector for guard metadata access       ║
║    ✓ SWC-powered controller loading                              ║
║                                                                  ║
╚═══════════════════════════════════════════════════════════════════╝

  curl localhost:${PORT}/api/v2/tasks
  curl localhost:${PORT}/api/v2/tasks/999
  curl localhost:${PORT}/api/v2/tasks/search?q=doc
  curl -X POST localhost:${PORT}/api/v2/tasks -H "Content-Type: application/json" -H "x-role: user" -d '{"title":"Hello","priority":"high"}'
  curl -X POST localhost:${PORT}/api/v2/tasks -H "Content-Type: application/json" -d '{"title":"Hello"}'  # → 403 (no role)
  curl -X DELETE localhost:${PORT}/api/v2/tasks/3 -H "x-role: admin"  # → 204
  curl -X DELETE localhost:${PORT}/api/v2/tasks/3 -H "x-role: user"   # → 403 (needs admin)
`)
  })
}

main().catch(console.error)
