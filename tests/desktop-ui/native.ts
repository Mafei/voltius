/** Browser fixture only. No native calls, credentials, user host or network connection. */
export const nativeFixture = { outputs: new Map<string, { onmessage: (value: unknown) => void }>(), inputs: [] as number[][],
  calls: [] as { command: string; args?: Record<string, unknown> }[], keyboardVisible: false,
  setKeyboard(on: boolean) { this.keyboardVisible = on; window.dispatchEvent(new Event("fixture-keyboard")); },
  write(sessionId: string, text: string) { this.outputs.get(sessionId)?.onmessage(Array.from(new TextEncoder().encode(text))); } };
export async function invoke(command: string, args?: Record<string, unknown>) {
  nativeFixture.calls.push({ command, args });
  if (command === "terminal_show_keyboard") nativeFixture.setKeyboard(true);
  if (command === "terminal_hide_keyboard") nativeFixture.setKeyboard(false);
  if (command === "terminal_output_attach") nativeFixture.outputs.set(args!.sessionId as string, args!.channel as { onmessage: (value: unknown) => void });
  if (command.endsWith("_send_input")) nativeFixture.inputs.push(args!.data as number[]);
  return command === "get_platform" ? /mobile-tabs|mobile-gestures/.test(location.search) ? "android" : "linux" : null;
}
export async function listen() { return () => {}; }
export async function emit() {}
export async function emitTo() {}
export async function once() { return () => {}; }
let channelId = 0;
export class Channel<T> { readonly id = ++channelId; onmessage: (value: T) => void = () => {}; }
export function useHostKeyConflict() { return { conflict: null, resolving: false, listening: true, resolveConflict: async () => {} }; }
