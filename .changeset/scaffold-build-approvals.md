---
'create-theokit': patch
---

`create-theokit … --use-pnpm` stops reporting a failure on a successful install.

pnpm 10 no longer reads the `pnpm` field in `package.json` — it says so in the first line of every
run — and that is where the template declared which dependencies may run install scripts. The list
was dropped, `esbuild` and `node-pty` were refused, `ERR_PNPM_IGNORED_BUILDS` set a non-zero exit,
and the scaffolder turned that into `✗ Failed to install dependencies with pnpm`. The very first
command in the quickstart reported failure on a directory that was complete.

The state it left behind was worse than the message: pnpm wrote a `pnpm-workspace.yaml` whose values
are the sentence *"set this to true or false"*, so the project began life with a config file that
reads like an unanswered question.

The scaffold now ships `pnpm-workspace.yaml` with the approvals already decided, and drops the field
from `package.json` — leaving it there costs a warning on every install for a setting that does
nothing.

Each entry says what the package is and why it needs to run code at install time, because approving
a build script is a decision about running arbitrary code on your machine, not boilerplate.
