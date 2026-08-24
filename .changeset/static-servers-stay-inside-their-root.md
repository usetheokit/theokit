---
'@theokit/http': patch
'theokit': patch
---

Both static-file servers now refuse to serve a file that lives outside the directory they were
configured to serve, and each of them reads the file it checked rather than re-resolving the path.

The traversal guards were operating on the path *string* while the read operated on the
*filesystem*, and a symlink is exactly the case where those two disagree. `serveStaticFile` resolved
to absolute and compared the result against `clientDir`; `createStaticHandler` rejected `..` and `//`
segments in the request pathname. Neither touches the disk, so an entry inside the served directory
that pointed somewhere else passed both checks and the server returned the target's contents — any
file the server process could open, to an unauthenticated `GET`. Serving a directory that also
receives uploads, or unpacking an archive that carries a symlink, is enough to put one there.

Containment is now decided by `realpath`, which asks the filesystem the question the string check
cannot answer. Symlinks are not banned: one whose target stays inside the served tree is ordinary and
is still served. Leaving is what is refused, and it is refused as "not here" rather than `403`, so
the response does not confirm what exists outside. A URL that walks out with `..` still gets its
`403`.

The same lines carried a second defect. Each server resolved the path more than once — check the
existence, stat the type or the size, then read the bytes — so what was checked was not necessarily
what was served. Each now opens one descriptor and does both through it. Where a size *limit* was
enforced this was the limit being bypassable rather than enforced: the custom error pages
(`MAX_ERROR_HTML_BYTES`) and the OpenAPI spec endpoint (`MAX_SPEC_BYTES`) both measured one file and
could read another. `@theokit/http` additionally reported `content-length` from a separately sampled
`stat.size` while the body came from its own read, so a file that changed size between the two
produced a response whose declared length disagreed with its body; the length now comes from the
bytes that were actually read.

A path that stays inside its root behaves exactly as before — same status, same headers, same bytes.
