/** Native IME ownership is independent of the WebView's DOM focus. */
let target: string | null = null;
let proxyFocused = false;
const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }
export function setAndroidTerminalTarget(value: string | null) {
  if (target === value) return;
  target = value; notify();
}
export function setAndroidTerminalProxyFocus(value: boolean) {
  if (proxyFocused === value) return;
  proxyFocused = value; notify();
}
export function androidTerminalOwnsFocus(sessionId: string) { return proxyFocused && target === sessionId; }
export function subscribeAndroidTerminalFocus(listener: () => void) {
  listeners.add(listener); return () => listeners.delete(listener);
}
