/** B-085/B-075 — the clipboard binaries this build will try, in resolution order. */
export interface ClipboardCommand {
  readonly bin: string
  readonly args: readonly string[]
}

/** Wayland first, then X11, then macOS — the order a Linux desktop actually resolves in. */
export const CLIPBOARD_COMMANDS: readonly ClipboardCommand[] = [
  { bin: 'wl-copy', args: [] },
  { bin: 'xclip', args: ['-selection', 'clipboard'] },
  { bin: 'xsel', args: ['--clipboard', '--input'] },
  { bin: 'pbcopy', args: [] },
]
