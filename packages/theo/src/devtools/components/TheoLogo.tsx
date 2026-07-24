/**
 * Theo brand logo — official purple logo from theo-business/arquivos.
 *
 * Embedded as base64 PNG (see ./assets/logo-data.ts) so the devtools UI has
 * zero external asset dependency.
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */
import { THEO_LOGO_BASE64 } from '../assets/logo-data.js'

interface TheoLogoProps {
  size?: number
}

export function TheoLogo({ size = 18 }: Readonly<TheoLogoProps>) {
  return (
    <img
      src={THEO_LOGO_BASE64}
      alt="TheoKit"
      width={size}
      height={size}
      style={{
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}
