/**
 * Every entry point the @theokit packages DECLARE must be importable from this project.
 *
 * This is the consumer half of a gate that already exists upstream: theokit-sdk checks that a
 * symbol marked `@public` resolves from its export map. That check runs inside the package that
 * makes the promise, against the tree it just built. It cannot see what an installed tarball does
 * on somebody else's disk — a file missing from `files`, a condition that resolves nowhere, a
 * subpath published without its build output. Those only fail here, in a project that installed it.
 *
 * Measured 2026-09-15 when this was written: 5 packages, 62 declared entry points.
 *
 * WHY IMPORT RATHER THAN STAT THE FILE. `exports` maps a subpath to conditions, and the condition
 * that matters is the one Node picks for THIS runtime. A file can exist at the path the map names
 * and still not import — a bad `main`, a missing transitive dependency, a syntax error in a build
 * that nobody loaded. Resolution answers "is there a file"; importing answers "does it load",
 * which is the question a consumer actually asks.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url).pathname;

/** Every @theokit package this project can see, with the entry points it declares. */
function installedPackages(): Array<{ name: string; from: string; entries: string[] }> {
  const roots = [
    join(ROOT, "node_modules/@theokit"),
    ...readdirSync(join(ROOT, "packages")).map((p) =>
      join(ROOT, "packages", p, "node_modules/@theokit"),
    ),
  ];
  const found = new Map<string, { name: string; from: string; entries: string[] }>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const pkg of readdirSync(root)) {
      const dir = join(root, pkg);
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, "utf8")) as {
        name: string;
        exports?: Record<string, unknown>;
      };
      // First occurrence wins: a transitive older copy must not mask the one this project pins.
      if (found.has(json.name)) continue;
      const entries = json.exports
        ? Object.keys(json.exports).filter((k) => k.startsWith("."))
        : ["."];
      // Resolve FROM THE CONSUMER, never from the package's own directory: self-referencing a
      // package by name asks a different question and fails with ERR_PACKAGE_PATH_NOT_EXPORTED on
      // any map without a "." key. Measured here on all 20 @theokit/agents entries at once — and
      // everything failing, including what demonstrably works, is what a broken query looks like.
      found.set(json.name, { name: json.name, from: join(root, "../.."), entries });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How a consumer loads this specifier. A `.json` subpath — `./package.json` is the common one, and
 * exporting it is correct practice, since tooling reads it — is NOT loadable as a module: Node
 * requires an import attribute. Skipping those entries would drop real coverage, so the attribute
 * is supplied rather than the entry excused.
 */
function importExpression(specifier: string): string {
  const spec = JSON.stringify(specifier);
  return specifier.endsWith(".json")
    ? `import(${spec}, { with: { type: "json" } })`
    : `import(${spec})`;
}

const packages = installedPackages();

describe("the published @theokit surface, from a project that installed it", () => {
  it("finds packages to check — an empty sweep proves nothing", () => {
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.reduce((n, p) => n + p.entries.length, 0)).toBeGreaterThan(0);
  });

  it("fails on a subpath nobody publishes — the probe can go red", () => {
    // Without this, a green run is indistinguishable from a probe that cannot fail. Three earlier
    // versions of this file failed EVERY entry because the query was wrong; a fourth could pass
    // every entry for the same kind of reason, and nothing would say so.
    const victim = packages[0];
    expect(victim).toBeDefined();
    expect(() =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", importExpression(`${victim.name}/there-is-no-such-subpath`)],
        { cwd: victim.from, stdio: "pipe", timeout: 30_000 },
      ),
      // MEASURED, not inferred: an unexported subpath raises ERR_PACKAGE_PATH_NOT_EXPORTED.
      // A bare `toThrow()` would also be satisfied by a crash for an unrelated reason — a missing
      // binary, a timeout — and would keep passing after the refusal it guards had decayed into
      // one of those.
    ).toThrow(/ERR_PACKAGE_PATH_NOT_EXPORTED/);
  });

  for (const pkg of packages) {
    describe(pkg.name, () => {
      for (const entry of pkg.entries) {
        const specifier = entry === "." ? pkg.name : `${pkg.name}/${entry.slice(2)}`;
        it(`imports ${specifier}`, () => {
          // A REAL node process, from the directory that depends on the package. Node is the
          // oracle here rather than a resolver call, for a reason measured on this very test:
          // `createRequire().resolve` asks for the `require` condition, so every entry of an
          // ESM-only package failed at once — 20 of 20, including entries the project imports
          // successfully in 1740 other tests. A sweep where everything fails is a statement about
          // the query. Importing the way a consumer imports removes the whole class of mistake.
          expect(() =>
            execFileSync(process.execPath, ["--input-type=module", "-e", importExpression(specifier)], {
              cwd: pkg.from,
              stdio: "pipe",
              timeout: 30_000,
            }),
          ).not.toThrow();
        });
      }
    });
  }
});
