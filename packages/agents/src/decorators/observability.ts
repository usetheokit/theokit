/**
 * Observability decorators for agent tracing and auditing.
 */
import { createDecorator } from '@theokit/http-decorators'

/** Enable distributed tracing for a tool/toolbox/agent. */
export const Trace = createDecorator<boolean>()

/** Enable audit logging for a tool/toolbox/agent. */
export const Audit = createDecorator<boolean>()
