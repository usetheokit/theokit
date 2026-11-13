export function fmtK(n: number): string {
  return n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : `${n}`
}
