/**
 * T1.2 — the image tool crosses the seam, and the one behavioural difference is recorded.
 *
 * ## The finding this closes
 *
 * `src/tools-entry.ts:18-20` claims *"The surface is preserved WHOLE (measured: 93 symbols, parity
 * identical to the source)"* and sets the rule *"If a symbol is ever deliberately withheld, the
 * reason comes written here."* Three symbols did not cross — `createViewImageTool`,
 * `CreateViewImageToolOptions`, `DEFAULT_MAX_IMAGE_BYTES` — with no reason written. The claim was
 * false by three, and the cost is measurable: `view_image` is the ONLY local tool in the consumer's
 * 10-tool registry, where the other nine are framework built-ins.
 *
 * ## Why the divergence below is recorded rather than used to justify withholding
 *
 * The plan's step 3 said: if the SDK factory and the consumer's local tool differ, stop and write
 * the divergence as the withholding reason. On measurement that conflates two separate questions,
 * and answering them together would close nothing:
 *
 *  - *Should the layer forward what `@theokit/sdk-tools` exports?* Yes — that is the entry file's
 *    own stated contract, and one consumer's local variant is not a reason to deny every other
 *    consumer the factory.
 *  - *Can THIS consumer drop the SDK factory in unchanged?* No. Their `toModelOutput` emits TWO
 *    blocks (a text line naming path and mime type, then the image); the SDK's emits ONE (the image
 *    alone, deliberately — a failure stays text so the model can read it and retry).
 *
 * So the symbols cross, and the difference is pinned HERE so the adoption task (T5.2) cannot swap
 * the implementation and silently change what the model receives. That is Risk R8, and it is the
 * reason this file asserts the block shape rather than merely the symbol's presence.
 */
import { describe, expect, it } from 'vitest'

import * as toolsEntry from '../../src/tools-entry.js'

describe('T1.2 — the image tool crosses the layer seam', () => {
  it('test_view_image_symbols_cross_into_the_layer', () => {
    // The parity claim at tools-entry.ts:18 is only true when these three are reachable from the
    // layer. Before this task they were absent, and nothing said why.
    expect(
      typeof (toolsEntry as Record<string, unknown>).createViewImageTool,
      'createViewImageTool must be forwarded — the entry claims the surface is preserved whole',
    ).toBe('function')
    expect(
      typeof (toolsEntry as Record<string, unknown>).DEFAULT_MAX_IMAGE_BYTES,
      'DEFAULT_MAX_IMAGE_BYTES is part of the tool contract: it is the ceiling a caller overrides',
    ).toBe('number')
  })

  it('test_the_layer_forwards_every_sdk_tools_factory_it_claims_to', async () => {
    // The count in the entry's comment is a claim about reality; this asserts reality instead.
    // A symbol added upstream and not forwarded is exactly how the consumer ended up writing its
    // own — the failure this test exists to make loud.
    const sdkTools = (await import('@theokit/sdk-tools')) as Record<string, unknown>
    const factories = Object.keys(sdkTools).filter((n) => n.startsWith('create'))
    const missing = factories.filter((n) => !(n in (toolsEntry as Record<string, unknown>)))
    expect(
      missing,
      `these @theokit/sdk-tools factories are not reachable from @theokit/agents/tools: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('test_sdk_view_image_emits_an_image_content_block', () => {
    // Risk R8 — the adoption task must not assume a drop-in. The SDK's toModelOutput returns the
    // IMAGE BLOCK ALONE on success; the consumer's returns a text line plus the image. Both are
    // defensible; they are not identical, and the difference is what the model sees.
    const tool = (
      toolsEntry as unknown as {
        createViewImageTool: (o: { projectRoot: string }) => {
          toModelOutput?: (out: string) => unknown
        }
      }
    ).createViewImageTool({ projectRoot: process.cwd() })

    expect(typeof tool.toModelOutput, 'the factory must expose toModelOutput').toBe('function')

    const blocks = tool.toModelOutput?.(
      JSON.stringify({ ok: true, path: 'a.png', media_type: 'image/png', bytes: 3, data: 'AAA' }),
    )
    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
    ])

    // The recorded divergence: exactly one block, no leading text. The consumer's local tool emits
    // `[{type:'text', …}, {type:'image', …}]`. T5.2 must decide deliberately, not by accident.
    expect(
      (blocks as unknown[]).length,
      'SDK emits image-only; the consumer emits text+image — adoption is a behaviour choice',
    ).toBe(1)
  })

  it('test_a_failed_read_stays_text_so_the_model_can_retry', () => {
    const tool = (
      toolsEntry as unknown as {
        createViewImageTool: (o: { projectRoot: string }) => {
          toModelOutput?: (out: string) => unknown
        }
      }
    ).createViewImageTool({ projectRoot: process.cwd() })

    const failure = JSON.stringify({ ok: false, reason: 'not_found' })
    expect(
      tool.toModelOutput?.(failure),
      'a failure must stay text — an error is not something to look at, and the model needs to read it',
    ).toBe(failure)
  })
})
