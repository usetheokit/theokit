import type { HttpVerb } from '../decorators/methods.js'

import { walkControllerMetadata, type WalkResult } from './walk-metadata.js'

export interface RouteRegistration {
  verb: HttpVerb
  fullPath: string
  walkResult: WalkResult
}

/**
 * Low-level API: walks decorator metadata per controller class and returns
 * structured route descriptors. Used internally by the Vite plugin (ADR D7)
 * and available to advanced consumers who don't use Vite.
 *
 * EC-5: deduplicates by class reference; warns on duplicates.
 */
export function registerControllers(controllers: Function[]): RouteRegistration[] {
  const seen = new Set<Function>()
  const unique: Function[] = []
  for (const Ctor of controllers) {
    if (seen.has(Ctor)) {
      console.warn(
        `[@theokit/http] Controller ${Ctor.name} registered multiple times — dropping duplicate`,
      )
      continue
    }
    seen.add(Ctor)
    unique.push(Ctor)
  }
  return unique.flatMap((Ctor) => {
    const walks = walkControllerMetadata(Ctor)
    return walks.map((w) => ({
      verb: w.verb,
      fullPath: w.fullPath,
      walkResult: w,
    }))
  })
}
