/** A keyboard preference is separate from the normal toolbar preference.
 * Viewport jitter never overwrites either explicit choice. */
export function terminalPanelsVisible(normal: boolean, keyboard: boolean | undefined, keyboardOpen: boolean): boolean {
  return keyboardOpen ? keyboard ?? false : normal;
}
