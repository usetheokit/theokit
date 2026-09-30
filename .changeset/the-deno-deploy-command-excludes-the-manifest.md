---
'theokit': patch
---

The emitted Deno deploy command excludes the manifest, which is what blocked the revision

Isolated on the real platform by changing one thing at a time in one directory:

    entry + deno.json + src/ + client/ + theo.config.ts     exit 0, `/api/health` 200, agent deltas "P" + "ONG"
    the same directory, plus `package.json`                  exit 1, revision failed
    the same directory, with `--ignore package.json`         exit 0, and serving again

`package.json` is what Deno resolves `npm:` specifiers against, so its version ranges bring the minimum-dependency-age policy with them — Deno refuses a version published inside a 24-hour window and says `Could not find npm package <name> matching <range>`, naming the package rather than the policy. The emitted entry reaches the framework through `npm:` specifiers that carry no range and resolve at latest, which is why excluding the manifest is a correction rather than a workaround.

Setting `minimumDependencyAge` in the generated config does NOT substitute for this; it was tried and the revision still failed, because the manifest is what resolution consults. Nothing here sets that value: lowering it withdraws a supply-chain protection, and that belongs to whoever owns the project.
