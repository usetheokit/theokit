---
'theokit': patch
---

The default CSP now declares `media-src 'self' data: blob:`.

It was absent, so `<audio>` and `<video>` fell back to `default-src 'self'` and a `blob:` URL was
blocked. Not hypothetical: `@theokit/plugin-voice` returns `audio/mpeg` from `/api/voice/tts`, and
the obvious way to play it — `URL.createObjectURL(new Blob([bytes]))` — was refused by the browser:

    Loading media from 'blob:…' violates "default-src 'self'". Note that 'media-src' was not
    explicitly set, so 'default-src' is used as a fallback.

`img-src` already listed `blob:` for canvas exports. Someone thought about images generated in
memory and not about audio; the same reasoning covers both.
