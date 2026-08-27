---
'theokit': patch
---

A controller answering with binary now delivers the bytes it produced.

Audio, images, PDFs, gzip — anything a controller returned was decoded as UTF-8 on its way out, so every byte `>= 0x80` became the replacement character. A 55 296-byte MP3 arrived as 76 790 bytes that no player would open, under a `200` and a correct `content-type`; the damage was invisible until someone opened the file. File routes were never affected, so this was a silent divergence between two paths meant to be at parity.

Controllers still BUFFER the body — a streamed response is collected before the first byte goes out, unchanged from before. Progressive delivery on that path is tracked separately.
