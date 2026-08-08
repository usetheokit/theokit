# Plans

* [Plan: surface partial-tool-call as a typed stream event](agents-partial-tool-call-stream.md) - Exposing the SDK's partial-tool-call lifecycle as a typed AgentStreamEvent for progressive tool input.
* [Plan: the capability layer over the existing waist](capability-core.md) - Introducing the capability layer that produces the existing CompiledAgentOptions, proven byte-identical to the decorator path.
* [Plan: open the LoopStrategy seam](loop-strategy-seam.md) - Opening loopStrategy by composition and moving the termination ceiling into the runner.
* [Plan: the presenter package walking skeleton](presenter-layer-skeleton.md) - Creating @theokit/presenter and moving the web translator behind the contract with zero behaviour change.
* [Plan: the free factory functions become classes](sugar-to-oo.md) - Converting the free factory functions into capability classes with zero behaviour change, deleting the functions in the same milestone.
* [Discovery plan: tool-name contract at the agents/SDK boundary](tool-name-single-source-discovery.md) - The research questions asked before designing the tool-name contract.
* [Plan: single-source tool naming, and killing the dead HITL gate code](tool-name-single-source.md) - Making the tool-name rule exist in one place, applied where the name is minted, covering all three SDK rules.
