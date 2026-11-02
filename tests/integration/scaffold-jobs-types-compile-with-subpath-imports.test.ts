import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BUILD_HOOK_TIMEOUT_MS, buildTheokitPackageOnce } from './_helpers/build-theokit-package.js'

/**
 * The scaffold's `types/jobs.d.ts`, used as its own comments say, has to make the documented
 * `ctx.queue.enqueue('<name>', input)` compile in a route that imports only `theokit/server/<domain>`
 * subpaths, which is what the deprecation warning on `theokit/server` asks for. Two things stopped
 * it:
 *
 * - `route()` typed the handler's `ctx` as `unknown`, so `ctx.queue` was TS18046 and every app cast
 *   it (usetheokit/theokit#1073);
 * - the template augmented the deprecated `theokit/server`, which reaches `QueueClient` only when
 *   some file also imports the umbrella, so in a subpath-only app every job name was `never`
 *   (usetheokit/theokit#1074).
 *
 * The program is compiled by `tsc` against the built declarations, the files a consumer gets from
 * npm. The template is copied as shipped and edited the way its comments tell the reader to: one job
 * example and the `RouteContext` block uncommented.
 */
const REPO = resolve(__dirname, '../..')
const DIST = resolve(REPO, 'packages/theo/dist')
const TEMPLATE_JOBS = resolve(REPO, 'packages/create-theokit/templates/default/types/jobs.d.ts')
const TSC = resolve(REPO, 'node_modules/.bin/tsc')
const APP = resolve(__dirname, '..', '.tmp-scaffold-jobs-types-compile')

/**
 * The edits the template's comments ask for: one `JobRegistry` example, and the commented
 * `declare module 'theokit/server/define'` block, from its first line to its closing brace.
 */
function uncommentDocumentedLines(template: string): string {
  let inRouteContextBlock = false
  return template
    .split('\n')
    .map((line) => {
      const uncommented = line.replace(/^(\s*)\/\/ ?/, '$1')
      if (/^\s*\/\/ declare module 'theokit\/server\/define'/.test(line)) inRouteContextBlock = true
      if (inRouteContextBlock) {
        if (/^\s*\/\/ \}\s*$/.test(line)) inRouteContextBlock = false
        return uncommented
      }
      return /^\s*\/\/\s*'process-document':/.test(line) ? uncommented : line
    })
    .join('\n')
}

function compile(): { status: number | null; output: string } {
  const r = spawnSync(TSC, ['-p', APP], { encoding: 'utf-8' })
  return { status: r.status, output: `${r.stdout}${r.stderr}` }
}

describe('the scaffold jobs types compile in a subpath-only app', () => {
  beforeAll(() => {
    buildTheokitPackageOnce()
    rmSync(APP, { recursive: true, force: true })
    mkdirSync(join(APP, 'types'), { recursive: true })
    mkdirSync(join(APP, 'src'), { recursive: true })
    writeFileSync(
      join(APP, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          paths: {
            'theokit/server/jobs': [join(DIST, 'server/jobs/index.d.ts')],
            'theokit/server/define': [join(DIST, 'server/define/index.d.ts')],
          },
        },
        include: ['src', 'types'],
      }),
    )
  }, BUILD_HOOK_TIMEOUT_MS)

  afterAll(() => {
    rmSync(APP, { recursive: true, force: true })
  })

  it('test_ctx_queue_enqueue_is_typed_by_the_job_registry_without_a_cast', () => {
    const template = readFileSync(TEMPLATE_JOBS, 'utf-8')
    writeFileSync(join(APP, 'types', 'jobs.d.ts'), uncommentDocumentedLines(template))
    writeFileSync(
      join(APP, 'src', 'enqueue.ts'),
      `import { route } from 'theokit/server/define'

export const POST = route()
  .policy('public')
  .handler(({ ctx }) => {
    ctx.queue.enqueue('process-document', { documentId: 'doc-1' })
    // @ts-expect-error the registry types the input: documentId is a string
    ctx.queue.enqueue('process-document', { documentId: 1 })
    // @ts-expect-error a name missing from the registry is refused
    ctx.queue.enqueue('not-a-job', {})
    return { ok: true }
  })
  .build()
`,
    )

    const { status, output } = compile()
    expect(output).toBe('')
    expect(status).toBe(0)
  })
})
