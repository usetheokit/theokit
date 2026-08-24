# CodeQL triage — what was fixed, what was dismissed, and why

Every alert CodeQL raised on this repository was opened and read. Most were real and are fixed.
The rest are recorded here, one group per reason, because a dismissal that lives only in the
GitHub UI is a decision nobody can review later — and a 280-character comment is not room enough
to justify one.

**Re-open any alert whose reasoning below stops holding.** That is the point of writing it down:
these are judgements about the code as it is, not permanent exemptions.

## Fixed, not dismissed

These were genuine and were repaired. Listed so the dismissals below are read against a record of
what the scanner got right, not as a blanket claim that it cries wolf.

| Finding | Where | What it was |
|---|---|---|
| Symlink escape from the served root | `serveStaticFile`, `createStaticHandler` | Arbitrary file read over an unauthenticated `GET`. Reproduced against both before fixing. See [#428](https://github.com/usetheokit/theokit/issues/428). |
| Bypassable size limits | `error-pages.ts`, `serve-docs.ts` | The file was measured by path and then read by path, so the cap applied to a different file than the one served. |
| `content-length` disagreeing with the body | `@theokit/http` `readFileNode` | Length came from a separately sampled `stat.size`. |
| Internal detail disclosed over one transport but not another | `web-handler.ts`, `proxy.ts` | The redaction rule existed twice and was missing from a third path. |
| Log injection | `sendError` | A newline in an exception message appended forged lines to the log. |
| Quadratic padding strip | `base32Decode` | `/=+$/` on an authentication path. |
| Backslash not escaped in a generated key | `app-typed-client.ts` | A route segment ending in `\` broke the emitted `.d.ts`. |
| Shell command built from an absolute path | five test helpers | Broke on any checkout path containing a space. |

## Dismissed: mitigated at the sink, invisible to the analysis

`js/insecure-temporary-file`, `js/file-system-race` — `create-theokit` (alerts 270, 171, 172, 268)

Every scaffolded write goes through `writeScaffoldFile`
(`packages/create-theokit/src/write-file.ts`), which opens with
`O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW`. A symlink pre-planted at the final path component
makes the write fail `ELOOP`, leaving the file it pointed at untouched — demonstrated, not
assumed.

`O_NOFOLLOW` rather than exclusive-create because four call sites legitimately overwrite a file the
scaffolder itself just produced; `wx` would have broken `--bare` and `--surface` on their first run
without closing the vector.

**What it does not close**, stated so nobody infers a guarantee that is not there: `O_NOFOLLOW`
applies to the final component only. A symlinked *parent directory* is still followed, and closing
that needs `openat2` with `RESOLVE_NO_SYMLINKS`, which Node does not expose.

## Dismissed: fixed by a runtime condition static analysis cannot verify

`js/stack-trace-exposure`, `js/log-injection` (alerts 276, 163, 277, 278)

The message is redacted when `NODE_ENV === 'production'`, through one rule in
`packages/theo/src/core/contracts/client-safe-error.ts` that all three error paths ask. The log
site additionally passes both interpolated values through `oneLine`, so one call can only ever
produce one line.

CodeQL sees a taint reaching a sink and cannot evaluate the environment check standing between
them. Both mitigations are covered by tests that were each proven to fail when the mitigation is
removed:

- `tests/unit/web-handler-internal-error-redaction.test.ts`
- `tests/unit/send-error-log-injection.test.ts`

Development deliberately keeps the detail. An error message is what makes a framework debuggable,
and removing it outside production buys nothing.

## Dismissed: the stored value is the project's own error page

`js/stored-xss`, `js/xss-through-exception` (alerts 6, 7, 8, 9)

The value is `404.html` / `500.html`, read from the project's own build output by `loadIfSafe`
(`packages/theo/src/server/http/error-pages.ts`) and written to the response as HTML — because
serving it as HTML is the entire feature. Escaping it would render a custom error page as literal
markup, which is to say delete the capability.

The path is fixed configuration, never request-derived, and the file is authored by the same person
who authors every other template the framework serves.

## Dismissed: the race grants no capability the attacker does not already hold

`js/file-system-race`, `js/insecure-temporary-file` — CLI and build-time code
(alerts 25, 180, 181, 182, 183, 184, 185, 218, 279, 280)

These run in a developer's own project directory, in their own shell: `theokit generate`,
`theokit docker`, the config loader, the OpenAPI emitter. Winning the race requires write access to
that tree — and an attacker with write access can simply edit the source the command is about to
read or the file it is about to generate.

Rewriting these checks around file descriptors would add real complexity and change nothing about
what an attacker can do.

The contrast that makes this a judgement rather than a shrug: in the static-file servers the
attacker had only an unauthenticated HTTP request. Those were genuine, and they are fixed.

## Dismissed: test and harness infrastructure

`js/insecure-temporary-file`, `js/stack-trace-exposure` (alerts 219, 36, 267)

`tests/integration/_helpers/build-theokit-package.ts` holds a cross-process lock that concurrent
vitest workers use to agree on who builds `dist`. A predictable path is the mechanism — `mkdtemp`
would hand each worker a lock nobody else can see. The exposure that predictability costs is paid
for rather than ignored: the name is scoped to the current uid and the directory is created `0700`,
so a second account on the machine can neither redirect the run's writes nor read its state.

`tests/integration/body-parser-consumed-stream.test.ts` is a loopback HTTP fixture inside the test,
echoing its own error back to its own assertion.

## Dismissed: a documentation harness, run by hand

`js/http-to-file-access` (alerts 265, 266)

`docs/program/evidence/j09-harness/collector.mjs` is a local OTLP collector bound to `127.0.0.1`
whose output path is a **required** argv — defaulting it under a world-writable directory is
precisely what that file's own header refuses to do. Untrusted content reaching a log file is what
a collector is for. It is not shipped, not imported by any package, and not reachable off-host.

## Dismissed: a valid call the model reads as invalid

`js/superfluous-trailing-arguments` (alert 264)

`new TransformStream({ transform })` is a valid single-argument call — the writable and readable
strategies are optional. No superfluous argument is passed.

Note that the same rule was *right* five times over in `packages/http/examples/`, where every
decorator was being handed a property descriptor that no decorator in that package reads. Those are
fixed, not dismissed.
