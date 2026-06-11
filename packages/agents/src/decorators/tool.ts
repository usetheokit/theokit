/**
 * @Toolbox() + @Tool() — group and define agent tools.
 *
 * @Toolbox({ namespace }) is a class decorator that groups related tools.
 * @Tool({ name, description, input, risk }) is a method decorator compiled to defineTool().
 *
 * @UseGuards on @Toolbox applies to ALL tools (per ADR D7).
 */
import { setMeta, getMeta, TOOLBOX_CONFIG, TOOL_CONFIG, TOOL_METHODS } from '../metadata/index.js'
import type { ToolboxOptions, ToolOptions } from '../types.js'

/**
 * Convention: TaskTools → namespace: 'tasks', ProjectTools → namespace: 'projects'
 * Strips "Tools" suffix, converts to kebab-case.
 */
function inferNamespace(className: string): string {
  const stripped = className.replace(/Tools$/, '')
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

export function Toolbox(options: ToolboxOptions = {}): ClassDecorator {
  return (target: Function) => {
    const ns = options.namespace ?? inferNamespace(target.name)
    setMeta(TOOLBOX_CONFIG, target, { ...options, namespace: ns })
  }
}

export function Tool(options: ToolOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    setMeta(TOOL_CONFIG, actualTarget, options, propertyKey)
    // Accumulate tool methods list
    const existing = getMeta<(string | symbol)[]>(TOOL_METHODS, actualTarget) ?? []
    setMeta(TOOL_METHODS, actualTarget, [...existing, propertyKey])
  }
}

export function getToolboxConfig(target: Function): ToolboxOptions | undefined {
  return getMeta<ToolboxOptions>(TOOLBOX_CONFIG, target)
}

export function getToolMethods(target: Function): (string | symbol)[] {
  return getMeta<(string | symbol)[]>(TOOL_METHODS, target) ?? []
}

export function getToolConfig(
  target: Function,
  propertyKey: string | symbol,
): ToolOptions | undefined {
  return getMeta<ToolOptions>(TOOL_CONFIG, target, propertyKey)
}
