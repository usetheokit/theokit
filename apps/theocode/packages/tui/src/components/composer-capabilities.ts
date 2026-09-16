import type { ComposerCapabilities } from '@theokit/tui'

/**
 * B-006 — what THIS build wires, declared once and read by every surface that advertises.
 *
 * The derivation itself lives in `@theokit/tui` (`composerShortcutsFor` / `footerHintFor`, shipped
 * by B-005). What cannot live there is this object: only the app knows which props it hands
 * `ChatComposer`. So the library owns the rule and the app owns the fact.
 *
 * Measured at `ConversationSlot.tsx`'s single `<ChatComposer/>`:
 *
 *   onHelpToggle={...}                          -> help: true
 *   commands={composerCommands(customCommands)} -> commands: true — always spreads BUILTIN_COMMANDS,
 *                                                  so the list is never the empty default
 *   (no onShellCommand)                         -> `shell` ABSENT
 *   (no fileSearch)                             -> mentions: true
 *
 * The last two lines look inconsistent and are not.
 *
 * `shell` is absent by DECISION: `docs/adr/0001-shell-shortcut-confinement.md` (B-056) keeps `!`
 * unwired because a `!cmd` has no turn, so the approval ledger has nothing to key on — wiring it
 * means building a second approval path beside the first. Flipping this one field to `true` is the
 * escape hatch that ADR describes: it restores the help line with no edit anywhere else.
 *
 * `mentions` is TRUE despite passing nothing, because `ChatComposer` declares
 * `fileSearch = defaultFileSearch` (`chat-composer.tsx:303`) — omitting the prop installs a
 * .gitignore-aware cwd walk rather than disabling the feature. The library's own field docstring
 * says "a mention provider is passed and can return results", which is the predicate the code does
 * NOT use; a consumer following it literally drops the `@` row for an affordance that works, which
 * is the inverse of the defect B-028 built this model to prevent. B-071 carries that correction
 * upstream. Until it lands, this comment is the reason the declaration disagrees with the docs.
 */
export const THIS_BUILD: ComposerCapabilities = {
  help: true,
  commands: true,
  mentions: true,
}

/**
 * Whether `←` opens an agents panel. Not built — B-072 carries the capability.
 *
 * B-067 — kept as a NAMED constant through the B-006 adoption rather than inlined as `false`:
 * the name is what tells the next reader the panel is unbuilt rather than disabled, and it is the
 * single seam B-072 flips.
 */
export const AGENTS_PANEL_WIRED = false
