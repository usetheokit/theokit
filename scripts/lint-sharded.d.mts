export const LINTABLE: RegExp
export const MAX_FILES_PER_SHARD: number
export function planShards(files: Iterable<string>, max?: number): string[][]
export function isOomAbort(r: { status: number | null; signal: string | null }): boolean
export function lintShard(
  shard: string[],
  run: (files: string[]) => { status: number | null; signal: string | null },
): boolean
