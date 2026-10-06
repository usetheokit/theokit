---
"theokit": patch
---

`theokit generate schedule` now writes the schedule to `<agentsDir>/schedules/`, the directory `theokit build` scans, and the schedule it writes runs your `chat` agent. (B-411)

In an app scaffolded by `create-theokit` (`agentsDir('src/server/agents')`) the generator used to write `agents/schedules/<name>.ts`, which the build never discovered, and the handler it wrote only logged a line. The generated handler now runs `chat` in-process at each fire under the `auto-reject` approval posture, so a gated tool such as `send_notification` does not run unattended, and it logs one line per fire with the schedule name, the trace id and the outcome. A failed fire still rejects, and the next tick runs. Each fire is a model run, so it needs the provider key in the environment of `theokit start`.

The generator now refuses instead of guessing: `theo.config.ts` that cannot be loaded, a project with no `chat.ts`, `chat.tsx` or `chat.js` in `agentsDir`, and an `agentsDir` that resolves outside the project each return a named error, and nothing is written.

**Migration:** a schedule generated earlier into a stray `agents/schedules/` directory is not moved for you. Move it to `<agentsDir>/schedules/`, or regenerate it.
