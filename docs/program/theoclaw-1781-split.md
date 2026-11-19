# TheoClaw #1781: scope split

Issue #1781 (TheoClaw) must stay limited to TheoClaw files. Its branch
(`factory/1781`) differs from its `workspace` merge base only in:

- `apps/theoclaw/CHANGELOG.md`
- `apps/theoclaw/src/triggers/trigger-route.ts`
- `apps/theoclaw/src/webchat/routes.ts`
- `apps/theoclaw/src/webhooks/google-chat.ts`
- `apps/theoclaw/tests/trigger-route.test.ts`
- `apps/theoclaw/tests/webhook-google-chat.test.ts`

Nothing from the items below remains on that branch.

## Follow-up: `@theokit/host` and presenter run-timeline

These were once mixed into the #1781 work and belong to their own issue
(follow-up of #2353, tracked from #1781):

- the `@theokit/host` package (`packages/host`);
- the presenter run-timeline source (`packages/presenter/src/source/from-run-timeline.ts`
  and its test);
- their documentation, workspace configuration and lockfile entries.

Both features are already in the shared `workspace` base, so the follow-up
needs no re-add on the #1781 branch. It only tracks their release and docs
under their own issue and changeset, not under TheoClaw.
