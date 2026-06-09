/**
 * Global Symbol-keyed metadata namespace constants for @theokit/http-decorators.
 *
 * Uses Symbol.for() (global Symbol registry) instead of Symbol() (local) because
 * the SWC loader imports controller files as separate module instances. With local
 * Symbols, the decorator-set metadata keys would be different Symbol instances from
 * the keys used by walkControllerMetadata — making metadata lookup silently fail.
 *
 * Symbol.for() ensures the SAME Symbol instance across module boundaries, which is
 * exactly how reflect-metadata keys should work in a multi-module decorator system.
 */

export const CONTROLLER_PREFIX = Symbol.for('theokit:http-decorators:controller-prefix')
export const ROUTE_METHODS = Symbol.for('theokit:http-decorators:route-methods')
export const ROUTE_PARAMS = Symbol.for('theokit:http-decorators:route-params')
export const ROUTE_STATUS = Symbol.for('theokit:http-decorators:route-status')
export const ROUTE_HEADERS = Symbol.for('theokit:http-decorators:route-headers')
export const ROUTE_REDIRECT = Symbol.for('theokit:http-decorators:route-redirect')
export const USE_GUARDS = Symbol.for('theokit:http-decorators:use-guards')
export const USE_INTERCEPTORS = Symbol.for('theokit:http-decorators:use-interceptors')
