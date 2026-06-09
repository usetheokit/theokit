import type { IncomingMessage } from 'node:http'

export class AuthGuard {
  canActivate(req: IncomingMessage): boolean {
    return req.headers['authorization'] === 'Bearer theokit-token'
  }
}
