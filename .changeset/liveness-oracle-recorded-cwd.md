---
"@theokit/agents": minor
---

`classifyProjects` (`@theokit/agents/session`) — answers "does the project behind `projects/<encoded>/` still exist?" without the caller writing the search itself.

`minor`, not `major`, and the distinction was measured rather than assumed: `npm pack @theokit/agents@9.4.0` ships the `./session` subpath but contains neither `classifyProjects` nor `FsSeam`. This is a new export on an existing subpath, so the option and seam changes made while stabilising it break no published consumer — there is none. The only migration note that would be honest is the one for the consumer this was absorbed from, and it is written as adoption guidance below rather than as a break.

The question is hard because `encodeProjectDir(cwd)` is `cwd.replace(/[^a-zA-Z0-9]/g, '-')` — one-way and many-to-one, so a directory name cannot be turned back into a path, only CHECKED against candidates. Every product that retains or garbage-collects transcripts has to answer it; the consumer's own version is 188 lines whose docstring measured 13,269 project directories, ~3,200 falling through to filesystem search and ~64M syscalls without a shared budget.

Three properties carry the safety of this module, and each exists because dropping it produced a measured deletion of live data:

- **The verdict is three-valued and `undetermined` is not a soft `dead`.** Callers DELETE on `dead`. Budget spent, unreadable directory, enumeration threw — all resolve to `undetermined`, because deleting on "could not tell" is data loss and the two errors are not symmetric.
- **`FsSeam.exists` returns `boolean | undefined`.** The third state is in the return type rather than in prose because that is the only place an adapter author reliably reads it. A signature of `=> boolean` invites `try { return existsSync(p) } catch { return false }` — which is exactly the consumer's scar B-020, where a cwd that exists but cannot be stat-ed (EACCES on a non-traversable parent, ENOTDIR mid-path, EMFILE under a wide sweep) was classified DEAD.
- **Every member of the collision class is probed, not the first match.** Because the encoding is many-to-one, `encodeProjectDir(cwd) === name` narrows to a CLASS, never to a path — `/home/op/my-app` and `/home/op/my/app` share one project directory. First-match-wins lets one record condemn the rest, and transcripts are user-writable, so that record can be PLANTED. Any live member now yields `alive`; `dead` requires every member to be definitively gone.

**The budget is shared across the whole sweep, not per project.** A bound that resets each iteration is not a bound — that is what produced the 64M figure.

Adoption (for a product that already wrote this search): supply `candidatePaths` returning REAL ABSOLUTE PATHS — not encoded directory names, which is the distinction that made 6 of 6 live projects classify `dead` while the two sides were being wired together — pass `projectsRoot` via the exported `projectsRoot()` rather than joining the segment by hand, and give `fs` an `exists` that returns `undefined` for every errno except ENOENT.
