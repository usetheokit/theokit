---
'@theokit/agents': minor
---

`loadInstructionTree` takes an `order`, so a rules folder is walked the way a rules folder means.

The predicate made a rules directory walkable and left the ordering the one an instruction TREE
needs — every file at a level before descending, because there the outer file states the general rule
and the inner one refines it. A rules FOLDER is the opposite shape: the files are peers, and the
contract its users depend on is that the same directory assembles the same prompt on any machine, in
one alphabetical pass.

Half a capability is its own kind of defect: offering the walk without the order left a caller able
to read a rules folder only in an order that misrepresents it.

Additive — `'outward-in'` stays the default, so no existing caller shifts.
