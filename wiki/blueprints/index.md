# Blueprints

* [Blueprint: AI-first canonical protocol](ai-first-canonical-protocol.md) - The canonical event protocol covering tool-call, tool-result, reasoning and finish.
* [Blueprint: AI-first walking skeleton](ai-first-walking-skeleton.md) - The fixture and assertion pattern to mirror, and the RED test shape for the first AI-first milestone.
* [Design spike: composable capabilities for agent authoring](capability-oo-design-spike.md) - The object-oriented capability design that replaced metadata-driven decorator authoring.
* [Blueprint: clean break on the proprietary agent surface](clean-break-proprietary-surface.md) - Removing the proprietary surface with a migration guide, a BREAKING changelog entry and a grep-to-zero gate.
* [Blueprint: cohesive harness over the SDK](cohesive-harness.md) - Wiring the SDK's own primitives into the app harness without building a second agent loop.
* [Blueprint: ecosystem integration guarantee for the TheoKit/SDK seam](ecosystem-integration-guarantee.md) - Bringing the TheoKit-to-SDK seam to the drift-guaranteed posture the other seams already have.
* [Blueprint: the layered SDK/TheoKit/AgentBuilder boundary](layered-oo-boundary.md) - The four decisions behind eliminating sugar and cutting the direct SDK import from the agent builder.
* [Blueprint: the injectable LoopStrategy seam](loop-strategy-seam.md) - Prior art and design for making the runner's stop criterion injectable without risking an infinite loop.
* [Blueprint: TheoKit as the multi-surface presentation layer](multi-surface-presentation-layer.md) - A canonical output event and a presenter contract so web and terminal stop re-implementing each other.
* [Blueprint: tool-name contract at the agents/SDK boundary](tool-name-single-source.md) - Why a documented namespace path never worked, and where the naming rule has to live instead.
* [Blueprint: unified zero-config agent surface](unified-agent-surface.md) - The naming and layout research behind a single zero-config agent surface.
