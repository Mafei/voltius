/** Synthetic PTY boundary; production touch/latch handlers run unchanged. */
export const inputMetrics: { sessionId: string; key: string; mods: { ctrl: boolean; alt: boolean } }[] = [];
export function sendSpecialKey(sessionId: string, key: string, mods: { ctrl: boolean; alt: boolean }) {
  inputMetrics.push({ sessionId, key, mods });
}
