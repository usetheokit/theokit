/**
 * Agent-native policy decorators — built on http-decorators' createDecorator<T>().
 *
 * These decorators work with Reflector.getAllAndOverride() for hierarchical
 * resolution: tool → toolbox → agent (method-level overrides class-level).
 */
import { createDecorator } from '@theokit/http'

import type { ApprovalOptions } from '../types.js'

/** Mark a tool as requiring human approval before execution. */
export const RequiresApproval = createDecorator<ApprovalOptions>()

// M53 — `RequiresCapability`, `Budget` and `Policy` were REMOVED (ADR 0002 § Group C): each wrote
// metadata that no production code ever read. `@Budget` in particular only triggered a warning
// saying it did nothing, and the walk hardcoded the per-tool `capabilities`/`budget` to `undefined`.
// A decorator whose only effect is a warning that it has no effect is a misleading affordance.
