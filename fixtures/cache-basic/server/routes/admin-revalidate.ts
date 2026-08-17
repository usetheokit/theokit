import { route, revalidatePath, revalidateTag } from 'theokit/server'
import { z } from 'zod'

export const POST = route()
  .body(
    z.object({
      tag: z.string().optional(),
      path: z.string().optional(),
    }),
  )
  .handler(async ({ body }) => {
    if (body.tag) {
      const { deleted } = await revalidateTag(body.tag)
      return Response.json({ ok: true, deleted, kind: 'tag' })
    }
    if (body.path) {
      const { deleted } = await revalidatePath(body.path)
      return Response.json({ ok: true, deleted, kind: 'path' })
    }
    return Response.json({ ok: false, error: 'specify tag or path' }, { status: 400 })
  })
  .build()
