---
'@theokit/agents': patch
---

`@theokit/agents/control`: `attachControlSocket` takes optional `runTurn` (a chat with no session), `doneFields`, `onTurnEnd` and `devices` (the owner-only `pair_code`, `pending_devices`, `approve_device` and `revoke_device` frames), accepts a store-less socket and an `authorize` verdict `{ owner, revoked }`, and reads `session: null` as no session. `createDevicePairing` keeps a request's `city`, adds `revokeDevice(id)`, `deviceIdFor` and a `report` hook. `pairRoute` takes `cityOf` and `errorNames`. `createSessionStore` is generic over the agent and takes `runTurn`, `dispose`, `steerAgent`, `badSessionCode`, `closedReason` and `reportPrefix`; an interrupt cancels the run and answers `no_turn` once the turn's events ended. `createControlClient` takes `stamp` to number frames as they arrive.
