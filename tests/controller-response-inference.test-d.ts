/**
 * #122 T2.1 / ADR-2 checkpoint — the typed client infers a controller method's
 * RESPONSE via the exact expression `app-typed-client` emits:
 *   Awaited<ReturnType<InstanceType<typeof Ctrl>['method']>>
 * This type-test proves that expression resolves correctly for both sync and
 * async handlers (request `@Body` types remain `unknown` by design — see #124).
 */
import { expectTypeOf, expect, test } from 'vitest'

// A controller-shaped class (decorators are runtime-only and irrelevant to the
// response TYPE the client infers, so a plain class exercises the exact expression).
class ThingsController {
  findById(_id: string): { id: number; title: string } | undefined {
    return { id: 1, title: 'seed' }
  }

  async create(): Promise<{ id: number; title: string }> {
    return { id: 2, title: 'made' }
  }
}

test('controller response inference resolves the method return type (sync + async)', () => {
  type FindByIdResponse = Awaited<ReturnType<InstanceType<typeof ThingsController>['findById']>>
  type CreateResponse = Awaited<ReturnType<InstanceType<typeof ThingsController>['create']>>

  expectTypeOf<FindByIdResponse>().toEqualTypeOf<{ id: number; title: string } | undefined>()
  // `Awaited<...>` unwraps the Promise for async handlers — same result shape.
  expectTypeOf<CreateResponse>().toEqualTypeOf<{ id: number; title: string }>()

  // The runtime return matches the inferred type (belt-and-suspenders).
  expect(new ThingsController().findById('1')).toEqual({ id: 1, title: 'seed' })
})
