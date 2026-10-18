/** Browser fixture only. No native calls, credentials, user host or network connection. */
export async function invoke(command: string) { return command === "get_platform" ? new URLSearchParams(location.search).has("mobile-tabs") ? "android" : "linux" : null; }
export async function listen() { return () => {}; }
export async function emit() {}
export async function emitTo() {}
export async function once() { return () => {}; }
let channelId = 0;
export class Channel<T> { readonly id = ++channelId; onmessage: (value: T) => void = () => {}; }
export function useHostKeyConflict() { return { conflict: null, resolving: false, listening: true, resolveConflict: async () => {} }; }
