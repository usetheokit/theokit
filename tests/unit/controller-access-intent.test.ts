/**
 * A controller says its access decision as INTENT, and a wrong reach fails loudly (#574).
 *
 * #514 closed the safety asymmetry between the two HTTP surfaces — a controller route that declares
 * no access decision now fails the build, as a file route always did. The EXPRESSION asymmetry it
 * exposed is what an adopter meets every day:
 *
 *   route builder   .policy('public')
 *   controller      @SetMetadata('theokit:public', true)
 *
 * One names the intent; the other hands over the framework's own metadata key as a string literal,
 * from a module (`cli/commands/build/emit-controllers.ts`) no entry point reaches — so the key could
 * not be imported even by a consumer who wanted to. Measured in the first real adopter: 8
 * controllers, 6 copies of that string.
 */
import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import {
  Public,
  PUBLIC_ROUTE_METADATA,
  Reflector,
  SetMetadata,
} from '../../packages/http/src/index.js'
import { subjectFromContext } from '../../packages/theo/src/core/contracts/route-policy.js'

describe('@Public() says the decision as intent (#574)', () => {
  it('marks a method exactly as the hand-written SetMetadata did', () => {
    // Equivalence is the contract: the build gate and the dispatcher read one key, and a decorator
    // that wrote a different one would be a second way to be public that only half the framework
    // agrees with.
    class WithDecorator {
      check(): void {}
    }
    class WithRawString {
      check(): void {}
    }
    Public()(
      WithDecorator.prototype,
      'check',
      Object.getOwnPropertyDescriptor(WithDecorator.prototype, 'check')!,
    )
    SetMetadata(PUBLIC_ROUTE_METADATA, true)(
      WithRawString.prototype,
      'check',
      Object.getOwnPropertyDescriptor(WithRawString.prototype, 'check')!,
    )

    const reflector = new Reflector()
    expect(reflector.getByKey(PUBLIC_ROUTE_METADATA, WithDecorator, 'check')).toBe(true)
    expect(reflector.getByKey(PUBLIC_ROUTE_METADATA, WithRawString, 'check')).toBe(true)
  })

  it('exports the key, so it stops being a string consumers must know', () => {
    // The point is not the value — it is that ONE definition is importable. While the key lived in
    // a build-time module, the docs had to instruct people to type it, and a rename would have
    // required a coordinated edit in every app that had ever written a public controller route.
    expect(PUBLIC_ROUTE_METADATA).toBe('theokit:public')
  })

  it('applies to a class as well as a method', () => {
    @Public()
    class OpenController {
      list(): string[] {
        return []
      }
    }

    expect(new Reflector().getByKey(PUBLIC_ROUTE_METADATA, OpenController)).toBe(true)
  })
})

describe('subjectFromContext refuses the object a controller author reaches with (#574)', () => {
  /**
   * The measured near-miss, from the adopter's own docblock:
   *
   * > An earlier version read `subjectFromContext` off the execution context — that context carries
   * > `getRequest`, `getUrl`, `getClass` and `getMethodName` and nothing else, so the lookup
   * > returned `undefined` and the guard denied EVERYONE. It passed the only test aimed at it,
   * > because that test checked that an unauthenticated request is refused.
   *
   * Silent AND fail-closed is the worst pair: nothing errors, nothing logs, and the failure is
   * shaped exactly like the feature working.
   */
  it('throws on an ExecutionContext instead of answering null', () => {
    const executionContext = {
      getRequest: () => new Request('http://example.test/'),
      getUrl: () => 'http://example.test/',
      getClass: () =>
        class Handler {
          find(): void {}
        },
      getMethodName: () => 'find',
    }

    expect(() => subjectFromContext(executionContext)).toThrow(/ExecutionContext/u)
  })

  it('names what to do instead, not just what went wrong', () => {
    let message = ''
    try {
      subjectFromContext({ getRequest: () => new Request('http://example.test/') })
    } catch (err) {
      message = (err as Error).message
    }

    expect(message).toMatch(/getRequest\(\)/u)
    expect(message).toMatch(/@Public\(\)/u)
  })

  /**
   * The load-bearing negatives. Without these the throw could be satisfied by refusing anything
   * without a subject — which would break every anonymous request on the route path, where `null`
   * is the correct and expected answer.
   */
  it('still answers null for a run-context with no subject — an anonymous caller', () => {
    expect(subjectFromContext({ subject: null })).toBeNull()
    expect(subjectFromContext({})).toBeNull()
    expect(subjectFromContext(null)).toBeNull()
  })

  it('still returns the subject when the run-context carries one', () => {
    const subject = { id: 'user-1' }

    expect(subjectFromContext({ subject })).toBe(subject)
  })

  it('does not throw for a context that has both — the shape is not the trigger, the absence is', () => {
    // A run-context that happens to expose `getRequest` AND carries a subject is not the mistake
    // this guards against, and refusing it would be a false positive on a legitimate caller.
    const subject = { id: 'user-2' }

    expect(subjectFromContext({ subject, getRequest: () => new Request('http://x/') })).toBe(
      subject,
    )
  })
})
