# Decisions (ADRs)

* [ADR 0001: patterns budget for capability-based agent authoring](0001-capability-patterns-budget.md) - Which design patterns the capability layer adopts and which it refuses, each with a reason.
* [ADR 0002: what happens to each agent decorator when the surface is deleted](0002-decorator-removal-scope.md) - Per-decorator disposition for the M53 removal, the hard gate being a decorator with no capability equivalent.
* [ADR 0002: single-source tool naming at the agents/SDK boundary](0002-tool-name-single-source.md) - Moving tool-name validation into the single place that mints the name, covering all three SDK rules.
* [ADR 0003: removing every backward-compatibility concession from M55](0003-no-backcompat-concessions.md) - Why the six compatibility concessions taken in M55 were reverted rather than kept.
* [ADR 0004: opening the LoopStrategy seam](0004-loop-strategy-seam.md) - Making the agent runner's stop criterion injectable, and moving the termination ceiling into the runner.
* [ADR 0005: the authoring surface is 100% classes](0005-sugar-to-oo.md) - Converting the free factory functions into classes, and the ADR 0001 premise that reversal overturns.
* [ADR 0006: unifying ConfigurationError on the SDK class](0006-configuration-error-unification.md) - Why two ConfigurationError classes silently lost a throw path, and how the re-export fixed instanceof across the boundary.
* [ADR 0007: lifecycle belongs to the product, the fold does not](0007-lifecycle-belongs-to-the-product-the-fold-does-not.md) - Why the presenter does not grow a Codex event set, and what IS framework-shaped in the gap.
