---
'create-theokit': patch
---

The scaffold says what it installed, and where to look before writing markup by hand.

It installs two component libraries and pointed at neither. A real app built on this template hand-wrote around 600 lines of navigation, queue rows, filters, status badges, empty states and a composer — and every one of them already existed in the packages the scaffold had put there. The components were present; nothing said so.

The README now carries a routing table — agent surfaces from `@theokit/ui`, app chrome from `@usetheo/ui` — and both it and the UI skill point at `node_modules/@theokit/ui/llms.txt`, which is written for an agent to read and carries the same table in full. `@usetheo/ui` has no such file, and that is stated rather than implied.

The UI skill also stops claiming a version. It said `@theokit/ui` was "currently `1.0.0`" while npm served `1.5.1` — a document cannot hold a number that moves, and `package.json` already does.
