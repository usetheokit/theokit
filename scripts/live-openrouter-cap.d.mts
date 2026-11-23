export const MAX_OUTPUT_TOKENS: number
export function capBody(body: string, limit?: number): string
export function capOpenRouterOutput(target?: { fetch: typeof fetch }, limit?: number): () => void
