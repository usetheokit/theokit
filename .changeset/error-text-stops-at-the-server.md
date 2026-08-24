---
'@theokit/agents': major
'@theokit/presenter': minor
---

The server's raw error text no longer reaches the browser by default.

Every failure the framework reported to a browser carried the server's own words: a tool handler's
stderr verbatim in `tool-output-error.errorText`, a run failure's message verbatim in
`error.errorText` — whatever a driver, an HTTP client or a filesystem call put in the exception.
`ai@7`, speaking the same UIMessage protocol, masks by default and says why in its own comment:
"prevent leaking server error details to the client by default". There was no equivalent here, and
no seam to add one.

Both are masked now, through one `onError` hook on the serving boundary
(`streamAgentUIMessages`, `streamAgentTurnInProcess`, and `mountAgent` by pass-through), defaulting
to a fixed string. The full text is not lost: it still reaches the server's logs and the
`agent.run` span, and the hook receives it — what stops is it reaching a browser unless the host
decides otherwise.

**A tool's error text masks by the same default as a run's**, which the report that raised this
deliberately left open. The deciding fact is that masking costs the model nothing: the presenter is
downstream of the SDK loop, observing events the model has already consumed, so the copy being
masked is the browser's and only the browser's. Two different defaults for "server text reaching a
browser" would be a rule nobody could hold.

The failure `code` keeps travelling on its own data part, so consumers still distinguish failures
without matching on text — masking that removed the discriminator would push them back into the
habit that part exists to have removed.

**Breaking** for `@theokit/agents`: an application that read the server's message out of
`errorText` now reads `'An error occurred.'`. Pass `onError: (e) => e.message` to restore the old
behaviour explicitly, which is the point — it becomes a decision instead of a default.
