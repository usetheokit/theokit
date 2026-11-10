export const LINTABLE: RegExp
export const MAX_FILES_PER_SHARD: number
export function planShards(files: Iterable<string>, max?: number): string[][]
