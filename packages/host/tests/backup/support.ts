import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

export async function scratch(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'host-backup-'))
  dirs.push(d)
  return d
}

export async function put(root: string, rel: string, data: string | Buffer): Promise<void> {
  const file = join(root, rel)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, data)
}
