import { setMeta, getMeta, ROUTE_STATUS, ROUTE_HEADERS, ROUTE_REDIRECT } from '../metadata/index.js'

export function HttpCode(status: number): MethodDecorator {
  return (target, propertyKey) => {
    setMeta(ROUTE_STATUS, target.constructor, status, propertyKey as string)
  }
}

export function Header(name: string, value: string): MethodDecorator {
  return (target, propertyKey) => {
    const existing =
      getMeta<[string, string][]>(ROUTE_HEADERS, target.constructor, propertyKey) ?? []
    existing.push([name, value])
    setMeta(ROUTE_HEADERS, target.constructor, existing, propertyKey as string)
  }
}

export interface RedirectMeta {
  url: string
  status: number
}

export function Redirect(url: string, status = 302): MethodDecorator {
  return (target, propertyKey) => {
    setMeta<RedirectMeta>(ROUTE_REDIRECT, target.constructor, { url, status }, propertyKey)
  }
}
