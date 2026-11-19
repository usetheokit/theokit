import { resolve } from 'node:path'

const tails = new Map<string, Promise<void>>()

/**
 * Runs `task` after every earlier task for the same file has finished, whichever way the path is
 * spelled (`/a/b` and `/a/./b` share a queue), so a read-modify-write of one file never interleaves
 * with another in this process. A failed task does not stop the ones queued behind it.
 */
export function serializedPerFile<T>(path: string, task: () => Promise<T>): Promise<T> {
  const key = resolve(path)
  const run = (tails.get(key) ?? Promise.resolve()).then(task)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  tails.set(key, tail)
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return run
}
