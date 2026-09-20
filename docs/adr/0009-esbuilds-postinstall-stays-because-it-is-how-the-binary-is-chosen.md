# 0009 — `esbuild`'s postinstall stays, because it is how the binary is chosen

- **Status:** accepted
- **Date:** 2026-09-20
- **Decides:** B-025's remaining bullet — *"`esbuild`'s `postinstall` is decided too, or the
  decision records why it stays"*.

## Context

B-025 grouped two install-time costs of the same shape: `node-pty`'s build step and `esbuild`'s
`postinstall`, both described as *"a binary fetched by a script at install time"*. The first half
was settled by ADR 0004 and the package split; this is the second.

Measuring it first changed what the question is.

**`esbuild` is not ours to declare.** `packages/create-theokit/templates/default/package.json.tmpl`
mentions it zero times — a scaffolded app gets it transitively, through vite and the framework. So
there is no clause of ours to remove; there is a third-party package's own install script.

**And that script is the mechanism, not an extra.** `esbuild@0.28.2` ships
`"postinstall": "node install.js"` alongside **26 optionalDependencies** — one per
platform/architecture binary. The script is what selects the right one. It is not fetching
something on the side; it is the last step of installing the package at all.

## Decision

**It stays, and suppressing it is refused rather than merely not done.**

Suppressing a postinstall (via `pnpm.neverBuiltDependencies` or an equivalent) would leave
`esbuild` installed and unable to resolve its own binary. That is not a smaller install — it is the
failure B-025's *third* bullet forbids in its own words: *"it does not become a second way to fail
at install time — an optional dependency that silently does not install and then throws at
runtime."*

So the item's third requirement already answers its second. The cheapest-looking action here
produces exactly the outcome the item was filed to prevent.

## What would break, and what would not

**Nothing breaks: this decision keeps current behaviour.** No manifest changes, no lockfile
changes.

Had it gone the other way, the break would have been the worst kind — invisible at install, loud at
first build, and on contributor machines rather than in CI if CI happened to cache
`node_modules`.

## Who is affected

- **Anyone installing a scaffolded app** — unchanged; they were never choosing this.
- **Anyone tempted to shorten install time by disabling build scripts** — this ADR is the reason
  not to, for this package specifically.
- **B-025's other half** — the two-`esbuild` measurement is a separate bullet with its own
  evidence file and is not decided here.

## What was rejected

**Add `esbuild` to a never-built list.** Rejected above: it breaks binary resolution and converts
an install-time cost into a runtime failure.

**Vendor or pin a single platform binary.** Rejected because the repository is developed and built
on more than one platform, and a pinned binary is correct on exactly one of them — trading a
portable install for a machine-specific one.

**Say nothing and let the cost stand undocumented.** Rejected because that is the state B-025 was
filed against: an unexamined cost and a deliberate one are indistinguishable from outside, and the
next person to look at a postinstall in a profiler would re-derive this from scratch.

## What this ADR does NOT settle

Whether a scaffolded app still installs `esbuild` **twice**. That is B-025's other bullet, it has
its own recorded evidence (`docs/program/evidence/b025-two-vite-majors-2026-08-20.txt`), and it is
about version skew rather than about install scripts. This repository currently resolves three
esbuild versions — 0.27.7, 0.28.1 and 0.28.2 — but a monorepo's dependency graph is not a
scaffolded app's, and no scaffold was run to check.
