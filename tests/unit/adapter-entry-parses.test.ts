/**
 * Every emitted deploy entry is a loadable ES module.
 *
 * A generated file nobody parses is a file nobody has run. `vercel.ts` declared
 * `const headers` twice in one function scope from #382 (2026-08-20) until
 * 2026-08-21, so `renderVercelFunctionEntry()` produced a module that Node
 * refused with `SyntaxError: Identifier 'headers' has already been declared`.
 * Twelve suites asserted on that string's contents and every one of them
 * passed, because `toContain` does not care whether the string is a program.
 *
 * `node --check` is the parser the runtime uses, so a green run here is the
 * strongest statement available without a deployment: the artifact loads. It
 * says nothing about behaviour — that is what `adapter-security-headers.test.ts`
 * exercises, by importing these same entries and reading a real response.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

const ENTRIES: Record<string, () => string> = {
  'cloudflare (ssrStreaming off)': () => renderCloudflareWorkerEntry({ ssrStreaming: false }),
  'cloudflare (ssrStreaming on)': () =>
    renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: '<!doctype html><html><head></head><body>',
      htmlTail: '</body></html>',
    }),
  vercel: () => renderVercelFunctionEntry(),
  netlify: () => renderNetlifyFunction(),
  bun: () => renderBunEntry(3000),
  'deno-deploy': () => renderDenoEntry(3000),
  'aws-lambda': () => renderAwsLambdaEntry(),
}

describe('every emitted deploy entry parses as an ES module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theo-adapter-parse-'))

  for (const [label, render] of Object.entries(ENTRIES)) {
    it(`${label} loads without a SyntaxError`, () => {
      const file = join(dir, `${label.replace(/[^a-z0-9]+/gi, '-')}.mjs`)
      writeFileSync(file, render())

      // `--check` resolves nothing, so an unresolvable bare specifier cannot
      // masquerade as a passing parse and a real SyntaxError cannot hide behind
      // one.
      expect(() => execFileSync(process.execPath, ['--check', file])).not.toThrow()
    })
  }
})
