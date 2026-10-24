# 0031: TheoClaw replies in each platform's own rendering

- Status: Accepted
- Date: 2026-10-24
- Deciders: the repository owner, through review round 1 of B-369 (plan `theoclaw-channel-loop`, findings F-xval-1, F-arch-1 and F-dom-2)
- Amends: decision D12 of the `theoclaw-channel-loop` plan, and the `translate` wording of FR-004 in its signed alignment brief

## Context

The reply handler builds one `ChatPresenter` per message. D12 of the plan kept the presenter on
`translate: (text) => toDialect(text, event.platform)`, as FR-004 of the signed brief words it, and
rejected `channelRendering(platform)` from `@theokit/gateway` 0.11.0 with two reasons: FR-004 names
`toDialect`, and the rendering change was display work that B-370 would own.

Building T1.6 showed that `toDialect` alone sends markdown that two of the ten platforms show raw.
`ChatPresenter` declares `format: "markdown"` unless told otherwise, and `toDialect` passes through a
platform it was not taught. The gateway package documents the result on `ChannelRendering`
(`packages/gateway`, `dist/index.d.ts` of 0.11.0 as installed):

> So matrix and email put `**bold**` on the wire as characters (matrix drops `markdown` with a
> warning, email escapes it into `<pre>`), and telegram and slack were handed a bold spelled for a
> dialect whose bold is a single asterisk. The text rewrite and the format flag have to be chosen
> together, per platform, by the package that knows what each adapter does with `format`.

`channelRendering(platform)` returns that pair, `{ format, translate }`, where `translate` rewrites
the same four inline markers `toDialect` knows (bold, italic, strikethrough, inline code), per
platform. It throws a `RangeError` for a platform it does not
know instead of falling back to identity and `markdown`.

The implementation switched to it on 2026-10-21 (commit `7e444f7a`) and recorded the switch in a
change-log line of the plan only. Review round 1 graded that as a reversal of a signed decision with
no ADR. This record is that ADR.

## Decision

The reply handler builds its presenter as
`new ChatPresenter({ channel: event.channel, ...channelRendering(event.platform) })`
(`apps/theoclaw/src/channels/reply-handler.ts`, `presenterFor`). FR-004 is unchanged
in every other respect: one agent turn and exactly one `ctx.reply` per message with text,
with reasoning dropped. Its `translate` clause is read as "the platform's rendering, which
`channelRendering` composes from `toDialect` and the matching `format`".

The rest of D12 is unchanged: one `GatewayRunner` per platform, the helper-built routes, and no
`createChannels`, `connectFailure: "isolate"` or `lineChannel`.

Tests that hold it: `apps/theoclaw/tests/channel-reply.test.ts` asserts the reply text and `format`
the presenter hands `ctx.reply`, including a LINE case built from `channelRendering('line')`.

## Considered options

1. **`channelRendering(event.platform)`** (chosen). Every platform gets text and `format` chosen
   together by the package that knows its adapter. It is one call to a published export, with no
   protocol logic in the app (REQ-7).
2. **`translate: toDialect` alone, as D12 decided.** Rejected: Matrix and e-mail receive literal
   `**bold**`, and Telegram and Slack receive a bold their dialect does not use, as the package
   documents above. The item would ship a reply path the package itself calls wrong on four of its
   ten platforms.
3. **`toDialect` plus a format table kept in the app.** Rejected: it copies, into the app, the
   per-adapter knowledge the gateway package already publishes as `channelRendering`, and the two
   would drift on the next gateway minor.
4. **Revert to `toDialect` and leave the format to B-370.** Rejected: B-370's definition of done is
   about which progress each platform sees (tool progress, live status, reasoning display over four
   tiers), not about the format of the final answer. Deferring would leave this item's one reply
   wrong on Matrix and e-mail until another item happened to touch it.

## Who is affected

- `apps/theoclaw` only. Searched `apps/` and `packages/` on 2026-10-24: `channelRendering` is called
  from `apps/theoclaw/src/channels/reply-handler.ts` and that app's tests, nowhere else.
- Operators, per the `RENDERINGS` table of `@theokit/gateway` 0.11.0: Telegram, Matrix and e-mail
  get plain text with the four inline markers removed, instead of literal `**bold**`; Slack gets
  its single-asterisk dialect; WhatsApp, LINE and SMS get the same text `toDialect` gave them, as
  `plain`; Discord, Mattermost and Teams get the markdown unchanged. No text content is dropped:
  only the inline markers are rewritten or removed.
- B-370 (`theoclaw-display-resolver`): it builds on this presenter and finds the final answer's
  format already chosen per platform. Its own scope, the progress tiers, is untouched. A note on its
  backlog block points here.
- The signed brief: FR-004 still requires one reply per turn. The wording change is recorded here
  rather than by editing a signed document.
