/**
 * ExecutionContext — Web Standard Request-based context passed to guards.
 *
 * Per ADR D460: the pipeline operates on Web Standard Request/Response.
 * node:http types live ONLY in the runtime adapter (runtime/node.ts).
 *
 * Guards access request headers via request.headers.get('x-role'),
 * NOT via req.headers['x-role'].
 */

/**
 * Execution context available in guards during request processing.
 * Uses Web Standard Request (works on Node, Bun, Deno, CF Workers).
 */
export interface ExecutionContext {
  /** The Web Standard Request object. */
  getRequest(): Request
  /** Parsed URL (convenience — avoids re-parsing). */
  getUrl(): URL
  /** The controller class constructor. */
  getClass(): Function
  /** The handler method name (property key on the controller). */
  getMethodName(): string | symbol
}

/**
 * Interface for guard classes (bound via @UseGuards).
 *
 * @example
 * ```ts
 * class RolesGuard implements CanActivate {
 *   canActivate(context: ExecutionContext): boolean {
 *     const request = context.getRequest()
 *     const role = request.headers.get('x-role')
 *     return role === 'admin'
 *   }
 * }
 * ```
 */
export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>
}

/** Create an ExecutionContext from a Web Standard Request. */
export function createExecutionContext(
  request: Request,
  controllerClass: Function,
  methodName: string | symbol,
): ExecutionContext {
  const url = new URL(request.url)
  return {
    getRequest: () => request,
    getUrl: () => url,
    getClass: () => controllerClass,
    getMethodName: () => methodName,
  }
}
