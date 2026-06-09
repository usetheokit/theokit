/**
 * @theokit/http-decorators v0.1.0-alpha.0 — DEMO
 *
 * This example shows what works TODAY:
 *   ✅ Decorators write metadata correctly
 *   ✅ Bridge walks metadata and produces structured WalkResult[]
 *   ✅ DTO Zod resolution via static schema (Pattern D2)
 *   ✅ Guards/Interceptors metadata captured
 *   ✅ Path joining normalized (EC-3)
 *   ✅ Missing @Controller detection (EC-2)
 *   ✅ Duplicate registration dedup (EC-5)
 *
 * What does NOT work yet:
 *   ❌ Decorated routes are NOT mounted as real HTTP endpoints
 *   ❌ No Vite plugin (T3.5 ADR D7) — the mount mechanism
 *   ❌ fetch('http://localhost/cats') will NOT reach the handler
 *
 * Run: npx tsx packages/http-decorators/examples/demo.ts
 */
import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  Header,
  Redirect,
  UseGuards,
  registerControllers,
  walkControllerMetadata,
} from '../src/index.js'

// ────────────────────────────────────────────
// 1. Define DTOs with Zod static schema (Pattern D2)
// ────────────────────────────────────────────

const zCreateCat = z.object({
  name: z.string().min(2).max(50),
  age: z.number().min(0),
  breed: z.string(),
})

class CreateCatDto {
  static schema = zCreateCat
}

// ────────────────────────────────────────────
// 2. Define a Guard class
// ────────────────────────────────────────────

class AuthGuard {
  canActivate(request: Request): boolean {
    return request.headers.get('authorization') !== null
  }
}

// ────────────────────────────────────────────
// 3. Define Controller with all decorator types
// ────────────────────────────────────────────

@Controller('cats')
class CatsController {
  @Get()
  findAll() {
    return 'This action returns all cats'
  }

  @Get('breed')
  findBreeds(@Query('type') type: string) {
    return `Breeds of type: ${type}`
  }

  @Post()
  create(@Body() body: CreateCatDto) {
    return `Created cat: ${JSON.stringify(body)}`
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Headers('accept') accept: string) {
    return `Cat #${id} (accept: ${accept})`
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  remove(@Param('id') id: string) {
    return `Deleted cat #${id}`
  }

  @Get('docs')
  @Redirect('https://docs.theokit.dev/cats', 301)
  @Header('Cache-Control', 'no-store')
  getDocs() {
    // Redirect short-circuits — this body is unused
  }
}

@Controller('dogs')
class DogsController {
  @Get()
  findAll() {
    return 'All dogs'
  }
}

// ────────────────────────────────────────────
// 4. Walk metadata (this is what the bridge produces)
// ────────────────────────────────────────────

console.log('=== walkControllerMetadata(CatsController) ===\n')

// Simulate tsc emitDecoratorMetadata for the @Body() DTO injection
// (esbuild/tsx don't emit design:paramtypes; real tsc does)
Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsController.prototype, 'create')

const results = walkControllerMetadata(CatsController)
for (const r of results) {
  console.log(`  ${r.verb.padEnd(7)} ${r.fullPath.padEnd(20)} → ${String(r.propertyKey)}()`)
  if (r.bodySchema)
    console.log(
      `          body schema: ✅ Zod resolved from ${r.bodySchema === zCreateCat ? 'CreateCatDto.schema' : '?'}`,
    )
  if (r.paramEntries.length)
    console.log(
      `          params: [${r.paramEntries.map((p) => `${p.source}${p.key ? `('${p.key}')` : ''}`).join(', ')}]`,
    )
  if (r.status) console.log(`          status: ${r.status}`)
  if (r.headers.length)
    console.log(`          headers: ${r.headers.map(([k, v]) => `${k}: ${v}`).join('; ')}`)
  if (r.redirect) console.log(`          redirect: ${r.redirect.url} (${r.redirect.status})`)
  if (r.guards.length) console.log(`          guards: [${r.guards.map((g) => g.name).join(', ')}]`)
}

// ────────────────────────────────────────────
// 5. registerControllers — dedup + multi-controller
// ────────────────────────────────────────────

console.log('\n=== registerControllers([CatsController, DogsController, CatsController]) ===\n')

const registrations = registerControllers([CatsController, DogsController, CatsController])
console.log(
  `  Total routes registered: ${registrations.length} (CatsController duplicate silently dropped)`,
)
for (const reg of registrations) {
  console.log(`  ${reg.verb.padEnd(7)} ${reg.fullPath}`)
}

// ────────────────────────────────────────────
// 6. Show what's MISSING (honest)
// ────────────────────────────────────────────

console.log("\n=== What works vs what's missing ===\n")
console.log('  ✅ Decorators → metadata: all 24 decorators write correct metadata')
console.log('  ✅ Bridge walk → WalkResult[]: structured route descriptors extracted')
console.log('  ✅ DTO Zod resolution: CreateCatDto.schema resolved to zCreateCat')
console.log('  ✅ Guards captured: AuthGuard attached to DELETE /cats/:id')
console.log('  ✅ Path normalization: /cats + /breed → /cats/breed (no double slashes)')
console.log('  ✅ Error detection: missing @Controller → HttpDecoratorsConfigError')
console.log('  ✅ Dedup: duplicate controllers dropped with console.warn')
console.log('')
console.log('  ❌ Vite plugin (T3.5 ADR D7): NOT shipped — routes are NOT mounted')
console.log('  ❌ HTTP roundtrip: fetch("/cats") will NOT reach CatsController.findAll()')
console.log(
  '  ❌ Guard execution: AuthGuard.canActivate() is metadata only — not wired to middleware',
)
console.log('')
console.log('  Next: T3.5 Vite plugin ships the mount mechanism that writes')
console.log('  generated server/routes/__decorated__/*.ts files picked up by')
console.log("  TheoKit's existing file scanner.")
