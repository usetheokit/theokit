/**
 * Agent-native policy decorators — built on http-decorators' createDecorator<T>().
 *
 * These decorators work with Reflector.getAllAndOverride() for hierarchical
 * resolution: tool → toolbox → agent (method-level overrides class-level).
 */
import { createDecorator } from '@theokit/http'

import type { ApprovalOptions, BudgetOptions, PolicyHandler } from '../types.js'

/** Mark a tool as requiring human approval before execution. */
export const RequiresApproval = createDecorator<ApprovalOptions>()

/** Require specific capabilities (permissions) to execute a tool. */
export const RequiresCapability = createDecorator<string[]>()

/** Set a cost budget for an agent or tool scope. */
export const Budget = createDecorator<BudgetOptions>()

/** Attach policy handler functions (CASL-style authorization). */
export const Policy = createDecorator<PolicyHandler[]>()
