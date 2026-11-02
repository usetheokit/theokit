/** How `theokit generate` turns a name such as `admin/user-profile` into identifiers. */

/** `admin/user-profile` becomes `AdminUserProfile`. */
export function toPascalCase(name: string): string {
  return name
    .split(/[-/]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

/** `admin/user-profile` becomes `adminUserProfile`. */
export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}
