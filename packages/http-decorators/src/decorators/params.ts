import { setMeta, getMeta, ROUTE_PARAMS } from '../metadata/index.js'

export type ParamSource =
  | 'req'
  | 'res'
  | 'body'
  | 'param'
  | 'query'
  | 'headers'
  | 'session'
  | 'ip'
  | 'host'

export interface ParamEntry {
  source: ParamSource
  key?: string
  index: number
  passthrough?: boolean
}

function makeParamDecorator(source: ParamSource) {
  return function (key?: string): ParameterDecorator {
    return (target, propertyKey, parameterIndex) => {
      if (propertyKey === undefined) return
      const map =
        getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, target.constructor) ?? new Map()
      const entries = map.get(propertyKey) ?? []
      entries.push({ source, key, index: parameterIndex })
      map.set(propertyKey, entries)
      setMeta(ROUTE_PARAMS, target.constructor, map)
    }
  }
}

export const Req = makeParamDecorator('req')
export const Body = makeParamDecorator('body')
export const Param = makeParamDecorator('param')
export const Query = makeParamDecorator('query')
export const Headers = makeParamDecorator('headers')
export const Session = makeParamDecorator('session')
export const Ip = makeParamDecorator('ip')
export const HostParam = makeParamDecorator('host')

export function Res(opts?: { passthrough?: boolean }): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) return
    const map =
      getMeta<Map<string | symbol, ParamEntry[]>>(ROUTE_PARAMS, target.constructor) ?? new Map()
    const entries = map.get(propertyKey) ?? []
    entries.push({
      source: 'res',
      index: parameterIndex,
      passthrough: opts?.passthrough,
    })
    map.set(propertyKey, entries)
    setMeta(ROUTE_PARAMS, target.constructor, map)
  }
}
