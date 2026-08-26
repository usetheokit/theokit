---
'@theokit/agents': minor
---

A paused run can reach its owner off the stream. `HitlWiring.onApprovalRequired` is the opt-in seam.

The framework's asynchronous promise — *the agent works and comes back when it needs your approval* — held only while a client was attached. `ApprovalRequiredEvent` went into the run's own event stream and nowhere else, so a caller not consuming that stream never learned the run was waiting, and it stayed parked until someone opened the surface and looked (#458).

```ts
createHitlPlugin({
  gated,
  emit,
  awaitApproval,
  onApprovalRequired: async ({ toolName, question, callbackUrl, timeoutMs }) => {
    await myDelivery.send({ text: `${question} — ${toolName}`, url: `${BASE}/${callbackUrl}` })
  },
})
```

It receives the same facts the stream carries and does whatever the **application** does. Deliberately not a `@theokit/gateway` dependency: this package must not import from it, and choosing a channel is a policy decision the framework does not get to make. `@theokit/gateway`'s `DeliveryRouter` is the obvious thing to hand it, and that stays the app's decision.

**Fire-and-forget by contract, and both halves of that are tested.** The run does not wait for it, so a slow dispatch cannot hold a gated tool open; and it does not fail on it, so a Slack outage cannot decide whether a gated tool runs. A rejected promise is swallowed — the outcome belongs to the human, not to the channel.

Optional: a wiring without the hook behaves exactly as before.
