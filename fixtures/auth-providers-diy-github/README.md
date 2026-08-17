# auth-providers-diy-github

DIY GitHub OAuth built on TheoKit's **RFC-stable auth primitives** — no
provider library. This is the AUTH-DELEGATION pattern: TheoKit ships
`generatePkceChallenge` (RFC 7636), `generateOAuthState` / `verifyOAuthState`
(CSRF defense), and `rotateSession` (fixation defense); you wire GitHub's
endpoints yourself.

## Flow

1. `GET /auth/start` — generate a PKCE challenge + state, stash the verifier,
   redirect to GitHub `/login/oauth/authorize` with `code_challenge`.
2. `GET /auth/callback` — verify `state`, exchange `code` + `code_verifier`
   for a token, load the GitHub user, `rotateSession` to a fresh authenticated
   session.
3. `GET /me` — read the session.

Set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` to run for real.
