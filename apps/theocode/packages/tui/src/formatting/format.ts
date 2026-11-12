export function fmtK(n: number): string {
  const trim = (v: number): string => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '')
  if (n >= 999_950) return `${trim(n / 1_000_000)}m`
  return n >= 1000 ? `${trim(n / 1000)}k` : `${n}`
}
