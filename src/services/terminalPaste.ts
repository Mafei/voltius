import { getTerminalApi } from "@/hooks/useTerminal";

import { sanitizePasteText } from "@/utils/sanitizeTerminalPaste";
export { sanitizePasteText } from "@/utils/sanitizeTerminalPaste";

export async function pasteToSession(sessionId: string, text: string): Promise<boolean> {
  const clean = sanitizePasteText(text);
  let api = getTerminalApi(sessionId);
  if (!api) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    api = getTerminalApi(sessionId);
  }
  if (!api) {
    console.warn(`paste dropped: no terminal for session ${sessionId}`);
    return false;
  }
  api.paste(clean);
  return true;
}
