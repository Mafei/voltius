/** Browser fixture only. No native calls, credentials, user host or network connection. */
export async function invoke(command: string) { return command === "get_platform" ? "linux" : null; }
export async function listen() { return () => {}; }
export async function emit() {}
export function useHostKeyConflict() { return { conflict: null, resolving: false, listening: true, resolveConflict: async () => {} }; }
