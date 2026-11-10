/**
 * Wait until a rendered TUI's composer reads keys. Ink draws the composer before its input handler
 * is attached, and a key written in between is dropped: under load the first word of a message went
 * missing. So readiness is observed, not slept for: a probe key is typed until the composer draws it,
 * then erased until the placeholder is back.
 */
const PROBE = "x";
const BACKSPACE = "\u007F";
/** How long one probe or one erase is given to be drawn before it is retried; a retry period, not a guess at readiness. */
const RETRY_MS = 200;

async function drawn(condition: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

export async function composerReady(
  write: (key: string) => void,
  screen: () => string,
  placeholder: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const fail = (what: string): Error => new Error(`the composer ${what} within ${timeoutMs} ms; screen:\n${screen()}`);
  const probed = (): boolean => screen().includes(`❯ ${PROBE}`);
  while (!probed()) {
    if (Date.now() > deadline) throw fail("never drew a typed key");
    write(PROBE);
    await drawn(probed, RETRY_MS);
  }
  while (!screen().includes(placeholder)) {
    if (Date.now() > deadline) throw fail("never erased the probe key");
    const before = screen();
    write(BACKSPACE);
    await drawn(() => screen() !== before, RETRY_MS);
  }
}
