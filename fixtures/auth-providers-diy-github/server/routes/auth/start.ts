import { defineRoute } from 'theokit/server'
import { generatePkceChallenge } from 'theokit/server'
import { generateOAuthState } from 'theokit/server'

/**
 * GET /auth/start — kick off GitHub OAuth with PKCE + state.
 * TheoKit ships the primitives; GitHub's endpoint is wired by hand.
 */
export const GET = defineRoute({
  async handler({ cookies }) {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = await generatePkceChallenge()
    const state = generateOAuthState()

    // Stash the verifier + state in short-lived cookies for the callback.
    cookies.set('gh_pkce_verifier', codeVerifier, { httpOnly: true, maxAge: 600 })
    cookies.set('gh_oauth_state', state, { httpOnly: true, maxAge: 600 })

    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID ?? '')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', codeChallengeMethod)
    url.searchParams.set('scope', 'read:user')

    return Response.redirect(url.toString(), 302)
  },
})
