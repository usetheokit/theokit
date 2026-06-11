import {
  setMeta,
  getMeta,
  USE_GUARDS,
  USE_INTERCEPTORS,
  USE_FILTERS,
  CATCH_EXCEPTIONS,
} from '../metadata/index.js'

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

export function UseFilters(...filters: Function[]): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol) => {
    const actualTarget = propertyKey ? target.constructor : target
    const existing = getMeta<Function[]>(USE_FILTERS, actualTarget, propertyKey) ?? []
    setMeta(USE_FILTERS, actualTarget, [...existing, ...filters], propertyKey)
  }
}

/** @Catch(ExceptionType, ...) — marks which exception types an ExceptionFilter handles.
 *  Empty args = catch-all filter. */
export function Catch(...exceptions: Function[]): ClassDecorator {
  return (target: object) => {
    setMeta(CATCH_EXCEPTIONS, target, exceptions)
  }
}
