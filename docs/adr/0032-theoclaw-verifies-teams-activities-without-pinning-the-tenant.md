# 0032: TheoClaw verifies Teams activities without pinning the tenant

- Status: Accepted
- Date: 2026-10-24
- Deciders: the repository owner, through review round 1 of B-369 (plan `theoclaw-channel-loop`, finding F-dom-1)
- Amends: decision D4 of the `theoclaw-channel-loop` plan

## Context

D4 of the plan built the Teams verifier as
`teamsActivityVerifier({ clientId: THEOCLAW_TEAMS_CLIENT_ID, tenantId: THEOCLAW_TEAMS_TENANT_ID })`.
The README of `@theokit/gateway-teams` 0.3.0, the version the app installs, says what that does on
the Bot Framework path (section "Two refusals follow from Microsoft's tokens"):

> A verifier configured with `tenantId` refuses every Bot Framework activity whose token carries no
> `tid` claim, and Microsoft documents none on connector tokens. Omit `tenantId` on that path unless
> you have confirmed your tokens carry `tid`.

So the route as shipped would answer 401 to every real Teams message. The tests did not see it
because they inject a fake verifier. The plan's own change log had left the question open "for the
live proof", and plan v1.14 removed every live proof from the item, so nothing left in the item
could settle it.

## Decision

`composeTheoClaw` builds the verifier with `{ clientId }` only. The verifier still checks the token's
signature against Microsoft's key set, its audience against the client id, its `serviceurl` claim
against the activity, and the activity's channel (`msteams`). It no longer compares a `tid` claim
that connector tokens do not carry.

`THEOCLAW_TEAMS_TENANT_ID` stays required: the Teams adapter that sends the replies takes it in its
constructor. The masking of configured values is unchanged, so the tenant id is still never written.

Regression test: `apps/theoclaw/tests/composition.test.ts`, "builds the teams verifier without the
tenant id, so Bot Framework tokens are not refused", which records the options the composition hands
the verifier factory.

## Considered options

1. **Build the verifier without `tenantId`** (chosen). This is what the package README prescribes for
   the Bot Framework path, and it is the only option under which a real connector token can pass.
2. **Keep `tenantId` (D4 as written).** Rejected: by the package's own documentation every Bot
   Framework activity is refused as `tenant_unverified`, so the Teams platform would be configured,
   started and unable to receive a message.
3. **Make tenant pinning opt-in through a new variable** that documents the need for tokens carrying
   `tid`. Rejected for now: no deployment of TheoClaw has such tokens, and a variable nobody can use
   yet is configuration to maintain for no reader (YAGNI). It is one option on the verifier call if a
   tenant with `tid`-carrying tokens appears.

## Who is affected

Searched `apps/theoclaw/src` on 2026-10-24: `teamsActivityVerifier` is called only from
`src/composition.ts` (`teamsVerifier`). The change is local to TheoClaw's Teams route. No other app
or package in this repository builds a Teams verifier.

What changes for an operator: a Teams activity signed by the configured bot is no longer refused for
lacking a tenant claim. A token issued by an Entra tenant is now refused by the package whatever the
tenant, since no tenant is configured (README, "a token issued by a specific Entra tenant is
refused"); connector tokens are not Entra-issued, so the Bot Framework path is the one that opens. No live Teams tenant was available to
confirm the end-to-end reply; the CHANGELOG says so.
