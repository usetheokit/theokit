---
'theokit': patch
---

Internal test fix, no runtime change: `test_ROOT_resolves_to_this_repository` asserted the name of the directory holding the checkout rather than the identity of the repository inside it.
