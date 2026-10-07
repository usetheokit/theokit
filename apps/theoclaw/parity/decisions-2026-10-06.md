# Parity decisions of 2026-10-06

Paulo decided these rows on 2026-10-06, in the S-001 session, answering questions Q1 and Q2 of
the parity ledger plan. They extend the table "Declared out by Paulo on 2026-10-04" in
`.squad/wiki/product/objectives.md`, which names "OC-37 to OC-43" as native mobile apps and device
nodes although three of those rows are not mobile.

| Row | What | Decision | Why |
|---|---|---|---|
| OC-37 | macOS menu bar app | out | a native desktop app per OS is a product of its own, and the desktop stays in through `@theokit/tauri` |
| OC-40 | Linux companion and Windows hub | out | the same reason as OC-37: a native app per OS, while `@theokit/tauri` covers the desktop |
| OC-41 | terminal UI | in | `theokit-tui` already exists, so the row stays open until it ships |
| H-7 | research-ready: batch trajectory generation and compression for training tool-calling models | out | it is tooling for training models, not a capability of a personal messaging assistant |

The objectives file is not edited here on purpose: its sha256 is bound by the product signature,
and a change to it would make that signature stale.
