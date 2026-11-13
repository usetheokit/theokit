/**
 * The usage text, and nothing else.
 *
 * Split from `args.ts` when that file crossed its line budget. The division earns its keep beyond
 * the count: this text is the CONTRACT a user reads, and `args.test.ts` holds it against the
 * subcommand table — keeping it beside the parser made it easy to edit one without the other, which
 * is the drift B-022 recorded.
 */
// B-022 — no `exec` here. It is the npm SCRIPT name (`npm run exec`), not a subcommand of the
// built binary, and the parser has no branch for it: the token fell through to the PROMPT, so
// following this text started a billable model turn instead of running the command. `README.md`
// had the correct form all along.
export const USAGE = `Usage: theocode [OPTIONS] [PROMPT]
       theocode resume [--last] [SESSION_ID] [PROMPT]
       theocode review (--uncommitted | --base <BRANCH> | --commit <SHA> | [PROMPT])
       theocode goal <OBJECTIVE> [--max-turns <N>] [--token-budget <N>]
       theocode sessions gc [--all-projects] [--apply] [--keep <N>] [--max-age-days <D>]
       theocode sessions (list | archive <ID> | rename <ID> <NAME> | delete <ID> | fork <ID>)
       theocode doctor   (reports the resolved install; exits non-zero when something is broken)
       theocode migrate-config   (converts a leftover config.toml into settings.json)

Options: --version/-v  --json  -m/--model <id>  -C/--cd <dir>  -o/--output-last-message <file>  --skip-git-repo-check
         -c/--config <key=value> (repeatable)  --sandbox <mode>  -a/--approval <policy>  --effort <level>
Stdout carries ONLY the final message (or JSONL with --json); progress goes to stderr.
Exit code is 1 when the turn fails or is interrupted (review findings do NOT affect it).`
