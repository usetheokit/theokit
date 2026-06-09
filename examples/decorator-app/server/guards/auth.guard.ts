import type { IncomingMessage } from 'node:http'

/**
 * AuthGuard — protects endpoints that require a Bearer token.
 *
 * Usage:
 *   @UseGuards(AuthGuard)
 *   @Get('stats')
 *   getStats() { ... }
 *
 * The guard checks the `Authorization` header for a valid Bearer token.
 * In production, this would validate a JWT or session token.
 */
export class AuthGuard {
  canActivate(req: IncomingMessage): boolean {
    const authHeader = req.headers['authorization']
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false
    const token = authHeader.slice(7)
    // In production: verify JWT here
    return token === 'theokit-token'
  }
}
