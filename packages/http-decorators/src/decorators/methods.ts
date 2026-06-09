import { setMeta, getMeta, ROUTE_METHODS } from '../metadata/index.js'

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL'

export interface RouteMethodEntry {
  verb: HttpVerb
  path: string
  propertyKey: string | symbol
}

function makeVerbDecorator(verb: HttpVerb) {
  return function (path = ''): MethodDecorator {
    return (target, propertyKey) => {
      const existing = getMeta<RouteMethodEntry[]>(ROUTE_METHODS, target.constructor) ?? []
      existing.push({ verb, path, propertyKey })
      setMeta(ROUTE_METHODS, target.constructor, existing)
    }
  }
}

export const Get = makeVerbDecorator('GET')
export const Post = makeVerbDecorator('POST')
export const Put = makeVerbDecorator('PUT')
export const Patch = makeVerbDecorator('PATCH')
export const Delete = makeVerbDecorator('DELETE')
export const Options = makeVerbDecorator('OPTIONS')
export const Head = makeVerbDecorator('HEAD')
export const All = makeVerbDecorator('ALL')
