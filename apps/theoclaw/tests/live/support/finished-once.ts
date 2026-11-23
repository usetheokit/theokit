/**
 * Wraps a run's `wait()` so `onFinished` fires once per run, however many callers wait on it
 * (the reply handler and the gateway handler both do), and only for a `finished` outcome.
 */
export function finishedOnce<R extends { readonly status: string }>(
  wait: () => Promise<R>,
  onFinished: () => void,
): () => Promise<R> {
  let pending: Promise<R> | undefined
  return () => {
    pending ??= wait().then((result) => {
      if (result.status === 'finished') onFinished()
      return result
    })
    return pending
  }
}
