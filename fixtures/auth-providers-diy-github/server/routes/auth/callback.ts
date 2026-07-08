import { route, rotateSession } from 'theokit/server'
import { verifyOAuthState } from 'theokit/server'

/**
 * GET /auth/callback — verify state, exchange code, rotate to an
 * authenticated session (fixation defense).
 */
export const GET = route()
  .handler(async ({ request, cookies }) => {
    const url = new URL(request.url)
    const returnedState = url.searchParams.get('state') ?? ''
    const storedState = cookies.get('gh_oauth_state') ?? ''

    if (!verifyOAuthState(returnedState, storedState)) {
      return new Response('OAuth state mismatch', { status: 403 })
    }

    const code = url.searchParams.get('code') ?? ''
    const codeVerifier = cookies.get('gh_pkce_verifier') ?? ''

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
      }),
    })
    const { access_token } = (await tokenRes.json()) as { access_token?: string }

    const userRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${access_token ?? ''}` },
    })
    const user = (await userRes.json()) as { id: number; login: string }

    // Fresh authenticated session — never reuse the pre-auth session id.
    await rotateSession(cookies, { userId: String(user.id), login: user.login })
    return Response.redirect('/', 302)
  })
  .build()
