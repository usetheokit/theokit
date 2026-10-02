---
'theokit': patch
---

The `devalue` floor moves to the first release without the three high-severity advisories

`devalue` serializes every server action result, and versions up to 5.9.2 carry three high-severity advisories: `stringify` serializing shared memory (GHSA-j22f-vq7h-c4qm), quadratic expansion in `uneval` (GHSA-mcm9-63f2-9j32), and an unhandled rejection from `stringifyAsync` (GHSA-x5rw-q4pp-hg5g). The declared range was `^5.8.1`, so an install could still resolve a vulnerable version. The floor is now `^5.9.3`, the first patched release, and the same major line is kept.
