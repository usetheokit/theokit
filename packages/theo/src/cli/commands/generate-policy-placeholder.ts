/**
 * The access policy a generated route carries until its author decides one.
 *
 * ADR 0001 made an undeclared `policy` a build error because "a route that nobody had thought
 * about was indistinguishable from a route deliberately left open". The generators then wrote
 * `'public'` — including on five methods that read and write a database table — so a generated
 * file was the not-thought-about case wearing the deliberate value, which is the precise state
 * the gate exists to make impossible (usetheokit/theokit#416). `theo build` accepted it, because
 * `assertEveryMethodDeclaresPolicy` asks whether a policy was declared, not which one.
 *
 * A generated route now REFUSES. The author still has to write the answer down — the gate's whole
 * purpose — but the value standing in until they do is the safe one rather than the open one.
 *
 * ## Why an AccessDecision and not `() => false`
 *
 * `evaluateRoutePolicy` maps a bare `false` to "access denied by route policy", which tells the
 * reader nothing about where to go. The contract already says a denial "carries its reason so the
 * caller can say it", so the refusal names its own file: the first `curl` against a forgotten
 * route prints the path to edit.
 *
 * ## Why a named const rather than a lambda per method
 *
 * Five methods would mean five copies, and deleting four of them is the kind of chore that leaves
 * the fifth behind. One const is one thing to replace, and `grep -rn undecidedPolicy` counts the
 * routes still awaiting a decision — which is the number ADR 0001 wanted to make greppable, and
 * which `grep -c "policy('public')"` could not give once generated placeholders were mixed in with
 * real decisions.
 */

/** The identifier the generated methods reference. Exported so callers cannot misspell it. */
export const UNDECIDED_POLICY_IDENT = 'undecidedPolicy'

/**
 * Lines declaring the placeholder, to splice into a generated module.
 *
 * @param routePath - the generated file's own path, repo-relative, so the refusal can name it
 * @param what - what the route does, in one clause, for the TODO comment
 */
export function undecidedPolicyDeclaration(routePath: string, what: string): string[] {
  return [
    `// TODO(policy): every route declares who may call it (ADR 0001). Generated as a REFUSAL`,
    `// rather than 'public', because the generator cannot know your access model —`,
    `// ${what}.`,
    `// Replace this with 'public' if the route is genuinely open, or with a check such as`,
    `// \`({ subject, params }) => requireOwner(subject, ownerOf(params.id))\`, then delete the const.`,
    `const ${UNDECIDED_POLICY_IDENT} = (): AccessDecision => ({`,
    `  allowed: false,`,
    `  reason:`,
    `    '${routePath} still carries the policy the generator wrote, which refuses everyone. ' +`,
    `    'Declare who may call this route (ADR 0001).',`,
    `})`,
  ]
}
