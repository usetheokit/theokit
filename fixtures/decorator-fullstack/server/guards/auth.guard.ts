import type { ExecutionContext } from '../../../../packages/http/src/bridge/execution-context.js'

export class AuthGuard {
  canActivate(context: ExecutionContext): boolean {
    const req = context.getRequest()
    return req.headers.get('authorization') === 'Bearer theokit-token'
  }
}
