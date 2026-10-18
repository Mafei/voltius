import { getPlatformSync } from "@/utils/platform";

/** Composition/dead-key/AltGr events belong to the input method, never app commands. */
export function isCompositionKey(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229 || e.key === "Dead" || e.key === "Process" || !!e.getModifierState?.("AltGraph");
}

export function isTerminalElement(target: EventTarget | null | undefined): boolean {
  return !!(target && "closest" in target && typeof target.closest === "function" && target.closest(".xterm, [data-terminal-key-target]"));
}

export function isTerminalKeyEvent(e: KeyboardEvent): boolean {
  return isTerminalElement(e.target) || (!e.target && typeof document !== "undefined" && isTerminalElement(document.activeElement));
}

export function isEditingKeyEvent(e: KeyboardEvent): boolean {
  const target = e.target;
  return !!(target && "closest" in target && typeof target.closest === "function" &&
    target.closest('input, textarea, select, [contenteditable="true"]')) && !isTerminalKeyEvent(e);
}

/** Default desktop policy: terminal chords/function keys pass through; macOS Command stays available.
 * A user can explicitly enable an app binding in terminal focus. Plain Ctrl+C always remains SIGINT.
 * Android keeps its existing keyboard/clipboard behavior.
 */
export function deferTerminalKey(e: KeyboardEvent, allowInTerminal = false): boolean {
  if (isCompositionKey(e)) return true;
  if (getPlatformSync() === "android" || !isTerminalKeyEvent(e)) return false;
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "c") return true;
  return !allowInTerminal && (e.ctrlKey || e.altKey || !e.metaKey);
}
