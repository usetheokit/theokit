/** Symbol.for metadata keys for agent decorators — cross-module safe with SWC loader. */

export const AGENT_CONFIG = Symbol.for('theokit:agents:config')
export const AGENT_MAIN_LOOP = Symbol.for('theokit:agents:main-loop')
export const TOOLBOX_CONFIG = Symbol.for('theokit:agents:toolbox')
export const TOOL_CONFIG = Symbol.for('theokit:agents:tool')
export const TOOL_METHODS = Symbol.for('theokit:agents:tool-methods')
