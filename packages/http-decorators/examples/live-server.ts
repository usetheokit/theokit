import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  Header,
  UseGuards,
} from '../src/index.js'
import { createDecoratorServer } from '../src/bridge/create-server.js'

// ── DTOs ───────────────────────────────────────────────

const zCreateCat = z.object({
  name: z.string().min(1, 'name is required'),
  age: z.number().min(0, 'age must be >= 0'),
  breed: z.string().optional(),
})

class CreateCatDto {
  static schema = zCreateCat
}

const zUpdateCat = z.object({
  name: z.string().min(1).optional(),
  age: z.number().min(0).optional(),
  breed: z.string().optional(),
})

class UpdateCatDto {
  static schema = zUpdateCat
}

// ── Guard ──────────────────────────────────────────────

class ApiKeyGuard {
  canActivate(req: { headers: Record<string, string | string[] | undefined> }) {
    return req.headers['x-api-key'] === 'theokit-secret'
  }
}

// ── Controller ─────────────────────────────────────────

const cats: Array<{ id: number; name: string; age: number; breed?: string }> = [
  { id: 1, name: 'Whiskers', age: 3, breed: 'Siamese' },
  { id: 2, name: 'Shadow', age: 5, breed: 'Persian' },
  { id: 3, name: 'Luna', age: 2 },
]

let nextId = 4

@Controller('cats')
class CatsController {
  @Get()
  @Header('X-Total-Count', String(cats.length))
  findAll() {
    return cats
  }

  @Get('search')
  search(@Query('breed') breed: string) {
    const found = cats.filter((c) => c.breed?.toLowerCase() === breed?.toLowerCase())
    return { breed, count: found.length, results: found }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    const cat = cats.find((c) => c.id === Number(id))
    if (!cat) return { error: 'not found' }
    return cat
  }

  @Post()
  create(@Body() body: CreateCatDto) {
    const data = body as z.infer<typeof zCreateCat>
    const cat = { id: nextId++, ...data }
    cats.push(cat)
    return cat
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpdateCatDto) {
    const cat = cats.find((c) => c.id === Number(id))
    if (!cat) return { error: 'not found' }
    Object.assign(cat, body)
    return cat
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    const idx = cats.findIndex((c) => c.id === Number(id))
    if (idx !== -1) cats.splice(idx, 1)
  }

  @Get('admin/stats')
  @UseGuards(ApiKeyGuard)
  adminStats() {
    return { total: cats.length, avgAge: cats.reduce((s, c) => s + c.age, 0) / cats.length }
  }
}

// ── Health ─────────────────────────────────────────────

@Controller('health')
class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      decorators: '@theokit/http-decorators v0.1.0-alpha.0',
    }
  }
}

// ── Boot ───────────────────────────────────────────────

// Simulate tsc emitDecoratorMetadata (esbuild/tsx don't emit design:paramtypes)
Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsController.prototype, 'create')
Reflect.defineMetadata(
  'design:paramtypes',
  [String, UpdateCatDto],
  CatsController.prototype,
  'update',
)

const PORT = 4000
const server = createDecoratorServer([CatsController, HealthController])
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  @theokit/http-decorators v0.1.0-alpha.0 — LIVE SERVER  ║
║  http://localhost:${PORT}                                  ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Endpoints:                                              ║
║    GET    /health              → health check             ║
║    GET    /cats                → list all cats             ║
║    GET    /cats/search?breed=  → search by breed           ║
║    GET    /cats/:id            → get one cat               ║
║    POST   /cats                → create cat (Zod valid.)   ║
║    PUT    /cats/:id            → update cat                ║
║    DELETE /cats/:id            → delete cat (204)          ║
║    GET    /cats/admin/stats    → guarded (x-api-key)       ║
║                                                          ║
║  Try:                                                    ║
║    curl http://localhost:${PORT}/health                     ║
║    curl http://localhost:${PORT}/cats                       ║
║    curl -X POST http://localhost:${PORT}/cats \\             ║
║      -H "Content-Type: application/json" \\               ║
║      -d '{"name":"Mittens","age":1}'                     ║
║    curl http://localhost:${PORT}/cats/admin/stats \\         ║
║      -H "x-api-key: theokit-secret"                     ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`)
})
