export interface ReleasePackage {
  dir: string
  name: string
  version: string
}
export function releaseSet(
  packages: ReleasePackage[],
  baselineVersion: (dir: string, name: string) => string | undefined,
): ReleasePackage[]
