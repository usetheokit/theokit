---
'create-theokit': patch
'@theokit/host': patch
'theokit': patch
---

An offsite download validates the manifest and each file's size and checksum before writing it, and `mountAgent` answers a failed credential resolution with a fixed message and code instead of the resolver's text.
