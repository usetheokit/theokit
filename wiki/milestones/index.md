# Milestone runs

* [Milestone M53: remove the agent decorators completely](m53-remove-agent-decorators.md) - The atomic decorator removal, its migration guide and the tests deleted along with the code they covered.
* [Milestone M54: open the LoopStrategy seam](m54-loop-strategy-seam.md) - Closing the runner's OCP asymmetry so the stop criterion is injectable like the other three axes.
* [Milestone M55: single-source tool naming](m55-tool-name-single-source.md) - Closing the six system-design findings from the review of the tool-name fix.
* [Milestone M56: remove every backward-compatibility concession from M55](m56-no-backcompat-concessions.md) - Reverting the six compatibility concessions M55 accepted, and the dependency cleanup that came with it.
* [Milestone M7: run-context dependency injection for tools](m7-run-context.md) - A shared typed run-context set at the agent and injected into every tool handler.
* [Milestone M8: fluent agent builder with type-state](m8-fluent-builder.md) - A composable agent builder that accumulates type-state so an unsatisfied requirement fails at compile time.
