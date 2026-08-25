---
'theokit': minor
---

`theoFetch` can send a POST. It could not.

`TheoFetchOptions<T>` omitted `method` while `buildRequestInit` read `opts.method` and defaulted to `'GET'`. So the two calls available to a consumer were both wrong: the one the docs teach did not compile, and the one that did compile went out as a **GET carrying a JSON body and no `X-Theo-Action` header** — the POST route was never reached, and nothing said so until someone opened the network panel.

`method` is part of the options type now, typed as the framework's own `HttpMethod` union so a typo fails to compile. When the route declares a `body` it is **required**, and narrowed to the mutating methods — a route with a body schema is not a GET, and saying that in the type is what removes the silent failure rather than merely unblocking it.

Nothing that works today breaks: no call carrying a body compiles at present.
