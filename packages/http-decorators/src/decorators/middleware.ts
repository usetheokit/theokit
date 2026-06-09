import { setMeta, getMeta, USE_GUARDS, USE_INTERCEPTORS } from '../metadata/index.js'

export function UseGuards(...guards: Function[]): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const actualTarget = propertyKey ? target.constructor : target
    const existing = getMeta<Function[]>(USE_GUARDS, actualTarget, propertyKey) ?? []
    setMeta(USE_GUARDS, actualTarget, [...existing, ...guards], propertyKey)
  }
}

export function UseInterceptors(...interceptors: Function[]): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const actualTarget = propertyKey ? target.constructor : target
    const existing = getMeta<Function[]>(USE_INTERCEPTORS, actualTarget, propertyKey) ?? []
    setMeta(USE_INTERCEPTORS, actualTarget, [...existing, ...interceptors], propertyKey)
  }
}
