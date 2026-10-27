import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * The composition root stays the top layer: the process entry (`src/main.ts`) is the one file
 * allowed to import it, and nothing imports the entry back, so the exemption cannot become a back
 * door to the composition.
 *
 * The rules are evaluated as regexes against path strings rather than by running
 * dependency-cruiser, because the question is what the rules SAY: `boundaries` proves they hold
 * over today's tree, and this test proves they would refuse the edges D3 names on any tree.
 */
interface ForbiddenRule {
  readonly name: string;
  readonly severity: string;
  readonly from: { readonly path?: string };
  readonly to: { readonly path?: string };
}

const config = createRequire(import.meta.url)("../.dependency-cruiser.cjs") as {
  readonly forbidden: readonly ForbiddenRule[];
};

function rule(name: string): ForbiddenRule {
  const found = config.forbidden.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`.dependency-cruiser.cjs declares no rule named ${name}`);
  }
  return found;
}

/** A missing `path` must fail loudly: `new RegExp("")` matches everything. */
function pattern(path: string | undefined, where: string): RegExp {
  if (path === undefined) {
    throw new Error(`${where} declares no path`);
  }
  return new RegExp(path);
}

describe("the entry boundary", () => {
  it("only the entry may import the composition root", () => {
    const compositionRule = rule("composition-root-is-the-top-layer");
    const from = pattern(compositionRule.from.path, "the composition rule's from");

    expect(compositionRule.severity).toBe("error");
    expect(from.test("src/channels/channel-loop.ts")).toBe(true);
    expect(from.test("src/main.ts")).toBe(false);
    expect(from.test("src/composition.ts")).toBe(false);
    // Only the top-level entry is exempt: a nested or similarly named file is still refused.
    expect(from.test("src/channels/main.ts")).toBe(true);
    expect(from.test("src/main.test.ts")).toBe(true);
    expect(from.test("src/mainframe.ts")).toBe(true);
  });

  it("nothing may import the entry", () => {
    const entryRule = rule("nothing-imports-the-entry");
    const from = pattern(entryRule.from.path, "nothing-imports-the-entry's from");
    const to = pattern(entryRule.to.path, "nothing-imports-the-entry's to");

    expect(entryRule.severity).toBe("error");
    expect(to.test("src/main.ts")).toBe(true);
    expect(to.test("src/main.tsx")).toBe(false);
    expect(from.test("src/composition.ts")).toBe(true);
    expect(from.test("tests/composition.test.ts")).toBe(true);
    expect(from.test("src/channels/channel-loop.ts")).toBe(true);
    expect(from.test("tools/check-parity-ledger.mjs")).toBe(false);
  });
});
