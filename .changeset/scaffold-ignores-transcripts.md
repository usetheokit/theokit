---
'create-theokit': patch
---

Conversation transcripts stop landing in git.

Every conversation a TheoKit app serves is written to `<app>/.data/agent-sessions/…/<sessionId>.jsonl`.
The scaffold's ignore file listed `data/` — without the leading dot — which matched nothing the
framework writes. A developer who ran the app once and committed put the full transcript of every
turn into version control: prompts, answers, tool inputs, tool results, and then into whatever
repository they pushed to.

The scaffold ignores `.data/` now, which covers the transcripts and the local SQLite database that
lives beside them.

What let this survive is worth naming: the comment above `resolveSessionBaseDir` asserted the
directory was "git-ignored", so the protection looked already handled to anyone reading the code.
Nothing in the framework can make that true — the ignore file is in a different tree — and the
comment now says so.

The regression test derives the path from `resolveSessionBaseDir` rather than repeating `.data/`, so
moving the transcripts breaks a test instead of quietly leaking again.
