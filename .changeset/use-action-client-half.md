---
'theokit': minor
---

`useAction` — call a server action from a component, with the framework's own error types.

```tsx
import { actions } from '@theo/actions'
import { useAction } from 'theokit/client'

const save = useAction(actions.saveMemory)
<button disabled={save.isPending} onClick={() => save.mutate({ content })}>Save</button>
```

The framework generated the typed callable, served it at `/api/__actions/`, and defined the error hierarchy it answers with — and then had nothing to call it from a component. `core/contracts/action-protocol.ts` opens by describing itself as the contract for "`defineAction` + `useAction`" and points the client half at `@theokit/react`, a package published outside this repository: one version, no `repository` field, and a `@theokit/sdk ^1.1.0` peer against a published 4.x. That is why `@theokit/plugin-forms` cannot be installed today without an unmet peer.

A failure lands in `error` as the protocol's own `ActionError`, so a validation failure is an `ActionInputError` with its `fields` map intact — the shape a form library binds to. Those classes are now exported from `theokit/client` as well as `theokit/server`; narrowing the error of a client hook previously meant importing the server barrel into a browser bundle.

`ActionClient`, the store underneath, is exported too: it is framework-agnostic, so a non-React surface can subscribe to it directly.
