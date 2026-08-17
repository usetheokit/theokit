# Edge Case Review — security-hardening

Date: 2026-06-10
Tasks analyzed: 4 (T1.1, T2.1, T3.1, T3.2)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: SHELL_METACHARS regex misses redirect operators and newlines

- **Affected task:** T1.1
- **Family:** Input
- **Scenario:** The plan's `SHELL_METACHARS = /[;|&$`(){}]/` blocks semicolons, pipes, ampersands, subshells — but does NOT block:
  - `>` and `<` (shell redirects): `npm test > /dev/null` or `npm test < /etc/passwd` pass through
  - `\n` (newline injection): `"npm test\nevil_command"` passes — the newline separates commands in many shells
- **Impact:** An LLM-crafted command like `npm test > /tmp/exfil` could redirect output to arbitrary files. Newline injection executes a second command entirely.
- **Suggested fix:** Expand regex to `/[;|&$`(){}<>\n\r]/`. 1 character class change.

## SHOULD TEST

### EC-2: Null byte in file path bypasses normalization

- **Affected task:** T1.1
- **Suggested test:** `test_path_null_byte_blocked()` — `isPathAllowed(allow:['src/**'], 'src/\x00.env')` should return false. Null bytes can truncate paths in C-level syscalls. Fix: reject paths containing `\x00` before normalization. One line: `if (filePath.includes('\x00')) return false`.

### EC-3: LRU session eviction with Map.keys().next() is O(1) only if Map preserves insertion order

- **Affected task:** T2.1
- **Suggested test:** `test_session_lru_evicts_first_inserted()` — create sessions 'a', 'b', 'c', hit cap, assert 'a' is evicted (not 'b' or 'c'). This is true for ES2015+ Maps but worth asserting to document the invariant. The plan's pseudo-code is correct for Node.js — just needs a test.

## DOCUMENT

### EC-4: picomatch as runtime dependency (not devDep)

- **Accepted risk:** The plan says "add picomatch devDep" but `sandbox.ts` is production source code (not test code). If `@theokit/agents` is published and a consumer imports sandbox utilities, picomatch must be a runtime dependency (or peerDep). Since sandbox is currently decorator-only (not called in production yet), devDep is fine for now — but when the sandbox runtime is wired, picomatch must move to `dependencies`. Accepted as-is; revisit when sandbox goes live.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 1 | 1 | 1 |
| T2.1 | 1 | 0 | 1 | 0 |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

The 1 MUST FIX (EC-1) is a real bypass — shell redirects and newlines are common injection vectors. The fix is 1 character class change in the regex.
