import type { UnlistenFn } from "@tauri-apps/api/event";
import { localResize, localSendInput, onLocalOutput } from "@/services/local";
import { onSerialOutput, serialWrite } from "@/services/serial";
import { onSshOutput, sshResize, sshSendInput } from "@/services/ssh";
import type { TerminalSession } from "@/types";
import { orderedOperation } from "./orderedOperations";
import { traceTerminal } from "./terminalTrace";

// Concurrent invokes run as separate backend tasks and land in any order under load.
let inputSequence = 0;
const pendingInputs = new Map<string, number>();
const pendingSince = new Map<string, number>();
export function terminalInputQueueState(sessionId: string) {
  const since = pendingSince.get(sessionId);
  return { queued: pendingInputs.get(sessionId) ?? 0, latency: since === undefined ? 0 : performance.now() - since };
}

/**
 * Write raw bytes to a session's transport. The single fan-out: the terminal's
 * keystroke path, PluginAPI's sendCommand and PluginAPI's sendInput all come
 * through here, so a transport added or fixed once is added or fixed everywhere.
 *
 * Rejects on transport failure. Callers that must not fail on a dropped
 * keystroke (the interactive terminal) swallow it at their own call site — a
 * swallow inside here would hide a failed MCP write.
 *
 * A `multiplayer` tab holds no transport of its own — its keystrokes travel the
 * relay — so it is a no-op here rather than a misrouted SSH write.
 */
export function sendSessionInput(
  sessionId: string,
  sessionType: TerminalSession["type"],
  data: Uint8Array,
): Promise<void> {
  if (sessionType === "multiplayer") return Promise.resolve();
  const write = () => {
    if (sessionType === "local") return localSendInput(sessionId, data);
    if (sessionType === "serial") return serialWrite(sessionId, data);
    return sshSendInput(sessionId, data);
  };
  const seq = ++inputSequence, start = performance.now();
  const tracked = sessionId.length <= 128 && (pendingInputs.has(sessionId) || pendingInputs.size < 128);
  if (tracked) {
    pendingInputs.set(sessionId, (pendingInputs.get(sessionId) ?? 0) + data.length);
    if (!pendingSince.has(sessionId)) pendingSince.set(sessionId, start);
  }
  traceTerminal(sessionId, "input_enqueue", { seq, bytes: data.length, queued: pendingInputs.get(sessionId) ?? 0, result: tracked });
  const next = orderedOperation(`pty:${sessionId}`, write);
  const settle = (ok: boolean) => {
    const queued = tracked ? Math.max(0, (pendingInputs.get(sessionId) ?? 0) - data.length) : 0;
    if (tracked) {
      if (queued) pendingInputs.set(sessionId, queued); else { pendingInputs.delete(sessionId); pendingSince.delete(sessionId); }
    }
    traceTerminal(sessionId, ok ? "input_ack" : "input_error", { seq, bytes: data.length, queued, latency: performance.now() - start });
  };
  void next.then(() => settle(true), () => settle(false));
  return next;
}

/**
 * Subscribe to a session's output events. The read-side twin of
 * `sendSessionInput`: the multiplayer host broadcast and PluginAPI's
 * `terminal.onOutput` both come through here, so a transport is wired for
 * every consumer at once rather than per call site — a shared local shell
 * relayed nothing to its guests because one such site listened only for
 * `ssh-output`.
 *
 * A `multiplayer` tab is a guest's view of someone else's session: it has no
 * local transport to listen to, so it resolves to a no-op unsubscribe.
 */
export async function onSessionOutput(
  sessionId: string,
  sessionType: TerminalSession["type"],
  callback: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  if (sessionType === "local") return onLocalOutput(sessionId, callback);
  if (sessionType === "serial") return onSerialOutput(sessionId, callback);
  if (sessionType === "multiplayer") return () => {};
  return onSshOutput(sessionId, callback);
}

/**
 * Push a terminal's dimensions to its transport. Same fan-out rationale as
 * `sendSessionInput`: every resize path (xterm's onResize, the force-fit after
 * a session becomes active, the connect transition) routes through here.
 *
 * Serial has no window size — it resolves to a no-op rather than a throw, so
 * callers never need to special-case the transport.
 */
export async function sendSessionResize(
  sessionId: string,
  sessionType: TerminalSession["type"],
  cols: number,
  rows: number,
): Promise<void> {
  if (sessionType !== "local" && sessionType !== "ssh") return;
  const seq = ++inputSequence;
  traceTerminal(sessionId, "resize_request", { seq, cols, rows });
  try {
    await orderedOperation(`pty:${sessionId}`, () => sessionType === "local"
      ? localResize(sessionId, cols, rows) : sshResize(sessionId, cols, rows));
    traceTerminal(sessionId, "resize_ack", { seq, cols, rows });
  } catch (error) {
    traceTerminal(sessionId, "resize_error", { seq, cols, rows }); throw error;
  }
}
