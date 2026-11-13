const trim = (v: number): string => v.toString().replace(/\.0$/, '')

export function fmtK(n: number): string {
  if (n < 1000) return `${n}`
  const k = Math.round(n / 100) / 10
  return k >= 1000 ? `${trim(Math.round(n / 100_000) / 10)}m` : `${trim(k)}k`
}
