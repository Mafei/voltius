import type { Terminal } from "@xterm/xterm";
import { sanitizePasteText } from "./sanitizeTerminalPaste";
import { useMobilePasteConfirmStore } from "@/stores/mobilePasteConfirmStore";

const pasting = new WeakSet<Terminal>();
export const isTerminalPaste = (term: Terminal) => pasting.has(term);
/** xterm emits onData synchronously. Pasted single characters must not consume
 * mobile Ctrl/Alt latches or become control bytes; xterm still owns bracketing. */
export function pasteWithoutModifiers(term: Terminal, text: string) {
  const nested = pasting.has(term);
  pasting.add(term);
  try { term.paste(text); } finally { if (!nested) pasting.delete(term); }
}
export async function pasteTerminalClipboard(term: Terminal, sessionId: string, text: string, android: boolean, accepts: () => boolean) {
  const clean = android ? sanitizePasteText(text) : text;
  if (!clean || !accepts()) return;
  if (android && clean.includes("\n") && !await useMobilePasteConfirmStore.getState().request(sessionId, clean)) return;
  // Permission, active session and connection may have changed during clipboard
  // access or the confirmation. Never redirect old clipboard text to a new tab.
  if (accepts()) pasteWithoutModifiers(term, clean);
}
