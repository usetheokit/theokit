---
'theokit': patch
---

A middleware the file-scan runner cannot invoke names itself instead of vanishing.

`middleware()` is a fluent builder: `middleware('name').handle(fn).build()`. Called the plausible
other way — `middleware({ name, handler })` — it returns the **un-built** builder, an object
`{ handle, build }`. The runner reads `typeof mw !== 'function'` and skipped it in total silence: the
file was found, the module was evaluated, the handler was never called, and the request succeeded
without it. Measured: a `globalThis` array a fixture creates at module scope DOES exist afterwards
and is EMPTY — evaluation happened, invocation did not.

It now warns with the file path and what is missing, from one function reached by both load sites.

**A warning and not a refusal**, deliberately. `refuseIncompatibleShape` shipped in `095c786d1` and
was removed the next day by `ab56b3888`, recording that refusing was "the right interim answer and
never the end state" because the README pointed users at a path that did not work. That removal was
right about the README and it also removed the diagnostic. This is the diagnostic without the refusal.

**Once per file per process**, not per request. The directory scan is cached, but `loadModule` runs
per file per request — so an unlatched warning would emit one line per request, which is how a
diagnostic becomes noise and then becomes filtered, at which point the defect is silent again.

Found by making the mistake while writing an unrelated regression test, with the source open, and
spending two rounds measuring the runner before doubting the call. A consumer has neither the source
nor the suspicion.
