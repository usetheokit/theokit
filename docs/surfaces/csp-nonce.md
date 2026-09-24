# The CSP nonce, and how an application component reads it

A Content-Security-Policy with `script-src 'self' 'nonce-…'` allows an inline `<script>` only when
the tag repeats that value in a `nonce` attribute. The node SSR target mints one per request
(`packages/theo/src/cli/commands/start/request-handler.ts:272`) and stamps it onto the scripts the
framework itself emits.

Anything **your** application inlines carries none, so the browser refuses it. `useNonce()` is the
seam that fixes that.

## Reading it

```tsx
import { useNonce } from 'theokit/client'

export function ThemeInit() {
  const nonce = useNonce()
  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: "document.documentElement.dataset.theme='dark'" }}
    />
  )
}
```

`useNonce()` returns the request's nonce during SSR, and `undefined` in the browser and on any target
that mints none. A target without a nonce is a supported state, not an error: React renders the
attribute away when the value is `undefined`.

## `suppressHydrationWarning` is MANDATORY, not advisory

The nonce is deliberately **not** serialised into the hydration payload — a nonce readable from the
page is a nonce an attacker can copy onto an injected tag. So the value is a string on the server and
`undefined` on the client, and react-dom compares the attribute and reports a mismatch. Omitting the
prop gets you the console error this seam exists to remove:

```
+ nonce={undefined}
- nonce=""
```

The framework does not inject the prop for you. Injecting it into your element would decide on your
behalf that that particular mismatch is acceptable, and the element — and its content — are yours.

### Which react-dom versions this was measured on

| react-dom | the attribute comparison | what we claim |
|---|---|---|
| **19.3.x** | present — the reconciler reads `node.nonce` | **measured**: without the prop the diff appears, with it there are zero nonce lines |
| 19.2.x | the static branch is absent | **unmeasured** at run time. The hook works identically; only the warning differs |

`scripts/probe-hydration.mjs --nonce-modes` is the instrument: it drives a real browser twice, with
and without the attribute, and prints the react-dom version **the page reports** alongside the
per-state result. It exits 2 when it cannot resolve the version or hydration did not run — never a
pass, because a measurement that did not happen is not a measurement that succeeded.

## What this does NOT do

- It does not stamp your inline scripts for you. Extending the framework's stamping pass to the SSR
  body is a security regression, measured: the regex it uses cannot tell a script inlined from
  untrusted content from a framework one, so it would nonce both. The framework stamps only the
  scripts it emits itself.
- It does not put the nonce anywhere the client bundle can read it back.

## Related

- `packages/theo/src/client/nonce.tsx` — the context, the provider and the hook
- `packages/theo/src/adapters/security-headers.ts` — what each deploy target does about the CSP
