/**
 * What the scaffold TEACHES must be importable and must exist (usetheokit/theokit#542, #79).
 *
 * The scaffold installs `dot-claude/skills/*` into every generated app, and those files are read by
 * an AI agent working inside the consumer's project. A wrong import there is not a snippet somebody
 * might copy — it is a recommendation to a reader who cannot check it.
 *
 * Two classes of defect were live at the same time when this was written, both found by driving the
 * published package rather than by reading:
 *
 * 1. **A fabricated symbol.** The agents skill taught `defineAgentTool`. The name is declared in the
 *    published `.d.ts`, so an editor autocompletes it and `tsc` accepts it — and no subpath exports
 *    it at runtime, so the call throws on the first request (#542). The scaffold used the real API,
 *    `tool()`, one directory away in `agents/tools/weather.ts`. A fresh app carried both.
 *
 *    Worse, `create-theo-default-template.test.ts` pinned the *signature* of that call
 *    (`inputSchema` + `handler`, the #79 fix) — a guard asserting the shape of a function that does
 *    not exist. It passed, and what it protected was a fiction.
 *
 * 2. **The deprecated umbrella.** Six documented imports read `from 'theokit/server'`, which still
 *    resolves and prints a deprecation warning naming a removal release. Anyone copying them, or
 *    letting an editor auto-import, inherits a removal date.
 *
 * This is deliberately a STRUCTURAL check and not a typecheck: a real one needs the framework built
 * and the registry reachable, and lives in the scaffold CI job. What it catches is these two shapes,
 * offline, on every run.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '../../templates')

function everyFile(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? everyFile(full) : [full]
  })
}

/** Files a consumer reads or copies from: docs, skills, and the template sources themselves. */
function teachingFiles(): { path: string; text: string }[] {
  return everyFile(TEMPLATES)
    .filter((f) => /\.(md|mdx|tmpl|ts|tsx)$/.test(f))
    .map((path) => ({ path: relative(TEMPLATES, path), text: readFileSync(path, 'utf8') }))
}

describe('the scaffold teaches imports that exist (#542, #79)', () => {
  it('nothing imports from the deprecated `theokit/server` umbrella', () => {
    // It resolves, so nothing fails — it prints a deprecation naming a removal release, which is
    // the kind of debt a scaffold should not hand out on day zero. Every symbol has a domain
    // subpath: `define`, `auth`, `http`, `security`, …
    const offenders = teachingFiles()
      .filter(({ text }) => /from ['"]theokit\/server['"]/.test(text))
      .map(({ path }) => path)

    expect(offenders, 'import from the domain subpath instead').toEqual([])
  })

  /**
   * Every `import { … } from 'theokit/<subpath>'` a teaching file contains.
   *
   * Markdown fences included: a skill is prose, and the import line inside its example is precisely
   * what a reader copies.
   */
  function documentedImports(): { file: string; subpath: string; names: string[] }[] {
    const found = []
    for (const { path, text } of teachingFiles()) {
      // `[\w/-]+` inside an optional group is a nested quantifier the ReDoS lint refuses, and it is
      // right to: this runs over every template file. The subpath is captured as one flat class —
      // `/` is just another character in it — which needs no nesting and matches the same strings.
      const pattern = /import\s*\{([^}]*)\}\s*from\s*['"](theokit[\w/-]*)['"]/g
      for (const match of text.matchAll(pattern)) {
        const names = match[1]
          .split(',')
          .map((n) =>
            n
              .trim()
              .split(/\s+as\s+/)[0]
              .trim(),
          )
          .filter((n) => n !== '' && !n.startsWith('type '))
        if (names.length > 0) found.push({ file: path, subpath: match[2], names })
      }
    }
    return found
  }

  /**
   * Asks the PACKAGE, rather than consulting a list of known-bad names.
   *
   * A list only ever knows what somebody already found — which is the exact vice of the guard this
   * file replaced: it pinned the signature of `defineAgentTool` and could never have noticed that
   * the function was missing. Importing the built package answers the question the compiler would,
   * for every documented name, including ones nobody has hit yet.
   *
   * Deliberately FAILS on an unbuilt tree instead of skipping. A doc gate that reports "not checked"
   * and exits 0 is how six unverified imports sat here for a day; the sibling `theokit-gateways`
   * repo hit the same shape and its answer was to make the check real, not quieter.
   */
  it('every documented name is exported by the subpath it is imported from', async () => {
    const PKG_ROOT = join(TEMPLATES, '../../theo')
    const manifest = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, { import?: string } | string>
    }

    expect(
      existsSync(join(PKG_ROOT, 'dist', 'index.js')),
      'build the packages first (`pnpm build:packages`) — this gate refuses to report a pass it did not earn',
    ).toBe(true)

    // Resolve through the package's OWN `exports` map rather than guessing a file layout. The first
    // version of this test derived `dist/<subpath>.js` and reported eleven false offenders against
    // real files at `dist/<subpath>/index.js` — a gate wrong about its own subject, which is worse
    // than no gate because the noise is what gets it disabled.
    const entryOf = (subpath: string): string | undefined => {
      const key = subpath === 'theokit' ? '.' : `.${subpath.replace('theokit', '')}`
      const entry = manifest.exports[key]
      if (entry === undefined) return undefined
      return typeof entry === 'string' ? entry : entry.import
    }

    // One import per SUBPATH, not per occurrence. Eleven template files import
    // `theokit/server/define`; loading it eleven times is eleven module graphs, which is what made
    // this time out inside the full suite while passing alone.
    const loaded = new Map<string, Record<string, unknown>>()
    const exportsOf = async (subpath: string) => {
      const cached = loaded.get(subpath)
      if (cached !== undefined) return cached
      const entry = entryOf(subpath)
      if (entry === undefined) return undefined
      const mod = (await import(pathToFileURL(join(PKG_ROOT, entry)).href)) as Record<
        string,
        unknown
      >
      loaded.set(subpath, mod)
      return mod
    }

    const offenders: string[] = []
    for (const { file, subpath, names } of documentedImports()) {
      const mod = await exportsOf(subpath)
      if (mod === undefined) {
        // The package declares no such subpath — a documented import that cannot resolve at all.
        offenders.push(`${file}: '${subpath}' is not a declared export of the package`)
        continue
      }
      for (const name of names) {
        if (!(name in mod)) offenders.push(`${file}: '${subpath}' has no '${name}'`)
      }
    }

    expect(
      offenders,
      'a documented import that does not resolve is an instruction to write code that throws',
    ).toEqual([])
    // Importing real module graphs is genuinely slower than reading files, and the suite's 5s
    // default is calibrated for the latter. Stated rather than left to chance.
  }, 30_000)

  it('the agents skill teaches the tool builder the scaffold itself uses', () => {
    // The positive half. Without it the two assertions above are satisfied by a skill that says
    // nothing about tools at all, which would pass while teaching nobody anything.
    const skill = readFileSync(
      join(TEMPLATES, 'default/dot-claude/skills/theokit-agents/SKILL.md'),
      'utf8',
    )
    const realTool = readFileSync(join(TEMPLATES, 'default/agents/tools/weather.ts'), 'utf8')

    expect(skill).toContain("from 'theokit/server/define'")
    expect(skill, 'the skill must show the same builder the generated app uses').toMatch(
      /tool\(['"][\w-]+['"]\)/,
    )
    expect(realTool, 'and that builder is what the scaffold actually writes').toMatch(
      /tool\(['"][\w-]+['"]\)/,
    )
  })
})
