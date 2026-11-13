export function fmtK(n: number): string {
  if (n < 1000) return `${n}`
  const tenthsK = Math.round(n / 100)
  if (tenthsK >= 10_000) return `${(Math.round(n / 100_000) / 10).toString().replace(/\.0$/, '')}m`
  return `${(tenthsK / 10).toString().replace(/\.0$/, '')}k`
}
