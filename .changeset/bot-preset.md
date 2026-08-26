---
'create-theokit': minor
---

`create-theokit my-app --preset=bot` — the always-on agent shape, scaffolded.

The framework already supports every piece of an unattended agent, and that was the problem: assembling one meant discovering, across twelve repositories, that you need `AgentBuilder` + `.approval()` + `deriveConversationId` + a `SandboxProvider` + `bindToolScope` + `defineCron` + a delivery channel. A preset is the cheapest answer to "how do I build the thing your landing page shows".

**A preset, not a second template.** A bot app and a web app share the shell, the config, the toolchain and the route conventions; what differs is the entry point — a schedule instead of a page — and the questions that follow from nobody watching. A second full template would duplicate the ninety percent that is the same and then drift, which is what `--surface` already avoids by layering.

**Two bots.** `researcher` writes notes into its own workspace; `publisher` reads them and publishes behind a `.approval()` gate. Two is where "whose conversation is this" and "whose workspace can it write to" become real questions; three starts being a demo application rather than a starting point.

**The isolation is enforced, not requested.** `botScope(botId)` composes the conversation id, the tool confinement and the workspace in one call — the piece people currently rediscover. `publisher` can read the researcher's notes and cannot write them, because its write root says so; a prompt asking a model not to write is a request, and a resolved-path check is a wall.

**No delivery channel is wired, deliberately.** `server/delivery.ts` prints. A default channel is a policy decision — an address you did not write, a workspace you may not have — so the seam is present, called from the places that need it, with one commented example. That is also why the scaffold runs before you configure anything.

An unknown preset is refused by name rather than silently scaffolding the plain template, and a preset whose files are incomplete in a build refuses before writing anything: a partial layer is an app importing files it does not have, failing at build time three steps from the cause.
