/**
 * The scaffolded app types its transcript against what it RECEIVES (usetheokit/theokit#396, #80).
 *
 * Twice now the template has typed a message as `@theokit/ui`'s `UIMessage` and filled it from
 * `useAgent()`, which returns the framework's wire message. The two are deliberately different —
 * the wire's parts are open so a `data-*` part or a future kind survives the trip, the renderer's
 * are a closed union it can draw — and neither can be made assignable to the other without giving
 * up what it is for.
 *
 * Both times the result was a fresh scaffold that failed its own `typecheck` script on commit zero,
 * in a file the template wrote. #80 was fixed in `app/page.tsx`; the same class came back in
 * `app/hooks/use-transcript.ts` as #396, because nothing pinned the rule.
 *
 * This pins it structurally. It is deliberately NOT a typecheck: a real one needs `@theokit/ui`
 * from the registry, and lives in the scaffold CI job. What this catches is the specific drift both
 * issues were — the template naming the renderer's message type as its own — offline, in the repo,
 * on every run.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const TEMPLATE_APP = join(fileURLToPath(new URL('../../templates/default/app', import.meta.url)))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('the default template does not name the renderer message type as its own', () => {
  it('test_no_app_file_imports_UIMessage_from_the_component_library', () => {
    const offenders = sourceFiles(TEMPLATE_APP).filter((file) => {
      const source = readFileSync(file, 'utf8')
      // Only the message types. `@theokit/ui` is the renderer and the template imports plenty from
      // it legitimately — components, `QuickAction`, the part types the conversion targets.
      return /import\s*\{[^}]*\bUIMessage\b[^}]*\}\s*from\s*'@theokit\/ui'/.test(source)
    })

    expect(offenders.map((f) => f.slice(TEMPLATE_APP.length + 1))).toEqual([])
  })

  it('test_the_conversion_to_the_renderer_shape_exists_and_is_used', () => {
    // The seam has to be somewhere. If this file disappears, the transcript is either typed as the
    // renderer's message again (the defect) or forced through with a cast (the same defect, quieter).
    const renderable = readFileSync(join(TEMPLATE_APP, 'lib', 'renderable.ts'), 'utf8')
    expect(renderable).toMatch(/export function toRenderable/)

    const panel = readFileSync(join(TEMPLATE_APP, 'components', 'ChatPanel.tsx'), 'utf8')
    expect(panel).toMatch(/toRenderable\(/)
  })

  it('test_the_conversion_does_not_reach_for_a_cast', () => {
    const renderable = readFileSync(join(TEMPLATE_APP, 'lib', 'renderable.ts'), 'utf8')

    // `as UIMessage` would make the file compile and put the drift back where a typecheck cannot
    // see it — which is worse than the error this replaces, because the error was at least visible.
    // Import ALIASES read as `as X` too, and are not casts — so only non-import lines are scanned.
    const body = renderable
      .split('\n')
      .filter(
        (line) =>
          !/^\s*(import|\s*\w+\s+as\s+\w+,?\s*)$/.test(line.trim()) &&
          !line.trimStart().startsWith('import'),
      )
      .join('\n')

    expect(body).not.toMatch(/\bas\s+(Renderable|UI)Message\b/)
    expect(body).not.toMatch(/as\s+unknown\s+as/)
    expect(body).not.toMatch(/@ts-(expect-error|ignore)/)
  })
})
