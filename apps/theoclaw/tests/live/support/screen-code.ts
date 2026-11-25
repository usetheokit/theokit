/** True when `answer` names `code`, whether the model wrote it joined or with whitespace between its characters. */
export function namesScreenCode(answer: string, code: string): boolean {
  const spaced = [...code].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
  return new RegExp(`(?<![A-Za-z0-9])${spaced}(?![A-Za-z0-9])`).test(answer)
}
