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

export function Toolbox(options: ToolboxOptions = {}): ClassDecorator {
  return (target: Function) => {
    setMeta(TOOLBOX_CONFIG, target, options)
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

export function getToolConfig(target: Function, propertyKey: string | symbol): ToolOptions | undefined {
  return getMeta<ToolOptions>(TOOL_CONFIG, target, propertyKey)
}
