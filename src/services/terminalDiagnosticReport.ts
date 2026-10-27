import { invoke } from "@/lib/invoke";
import { terminalTrace, traceTerminal, type TraceFields } from "./terminalTrace";
import { terminalDiagnosticState } from "@/hooks/useTerminal";
import { terminalInputQueueState } from "./sessionInput";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { getPlatformSync } from "@/utils/platform";
import { saveTextFile } from "./saveFile";
import { withLeaveLockSuppressed } from "./leaveLockSuppression";
import { getVersion } from "@tauri-apps/api/app";
import { androidKeyboardGeneration } from "./androidKeyboard";
import { useAppLockStore } from "@/stores/appLockStore";

function capture() {
  const state = useSessionStore.getState();
  const active = state.sessions.find((s) => s.id === state.activeSessionId);
  const sessions = [...(active ? [active] : []), ...state.sessions.filter((s) => s !== active)].slice(0, 128);
  for (const session of sessions) traceTerminal(session.id, "viewport", {
    ...terminalDiagnosticState(session.id), ...terminalInputQueueState(session.id),
    active: session.id === state.activeSessionId,
  });
  const ime = (window as unknown as { __voltiusInsets?: { ime?: number } }).__voltiusInsets?.ime ?? 0;
  traceTerminal(null, "viewport", { visible: document.visibilityState === "visible", focused: document.hasFocus(),
    imeVisible: ime > 0, dpr: window.devicePixelRatio, active: useMobileNavStore.getState().tab === "terminal",
    overlay: !!useMobileNavStore.getState().sheet || (useMobileNavStore.getState().stack?.length ?? 0) > 0,
    locked: useAppLockStore.getState().kind !== null });
}
async function captureNative() {
  const ids = terminalTrace.sessionIds();
  try {
    const counts = await invoke<TraceFields[]>("terminal_diagnostic_snapshot", { ids });
    if (!Array.isArray(counts)) return;
    counts.forEach((fields, index) => { if (ids[index]) traceTerminal(ids[index], "native_state", fields); });
  } catch { traceTerminal(null, "native_state", { errors: 1 }); }
  if (getPlatformSync() === "android") {
    const epoch = androidKeyboardGeneration(), id = useSessionStore.getState().activeSessionId;
    try {
      const state = await invoke<TraceFields>("terminal_keyboard_snapshot");
      if (state && state.epoch === epoch) traceTerminal(id, "native_state", state);
    } catch { traceTerminal(id, "native_state", { errors: 1 }); }
  }
}
/** A marker samples first. It does not focus, fit, reset, reconnect, or change keyboard state. */
export function markTerminalProblem(kind: "input" | "render") {
  capture();
  traceTerminal(useSessionStore.getState().activeSessionId, kind === "input" ? "marker_input" : "marker_render");
  void captureNative();
}
export function installTerminalTraceObservers(): () => void {
  const sample = () => { capture(); terminalTrace.prune(); };
  const events = ["focus", "blur", "resize", "voltius:insets"];
  events.forEach((event) => window.addEventListener(event, sample));
  document.addEventListener("visibilitychange", sample);
  const unsubscribe = useMobileNavStore.subscribe((s, prev) => { if (s.tab !== prev.tab || s.stack.length !== prev.stack.length || !!s.sheet !== !!prev.sheet) sample(); });
  // No background polling or new native wakeups: expiry is local memory only.
  const expire = setInterval(() => terminalTrace.prune(), 60_000);
  return () => { events.forEach((event) => window.removeEventListener(event, sample)); document.removeEventListener("visibilitychange", sample); unsubscribe(); clearInterval(expire); };
}
export async function exportTerminalTrace(): Promise<boolean> {
  capture(); await captureNative();
  let version = "unknown";
  try { version = await getVersion(); } catch { /* no arbitrary exception text in diagnostics */ }
  const report = { schema: 1, version, build: import.meta.env.VITE_BUILD_SHA ?? "development",
    generatedAt: new Date().toISOString(), retentionMinutes: 15, capacity: 2048,
    countersAreContentFree: true, stats: terminalTrace.stats(), droppedOnExport: 0, events: terminalTrace.snapshot() };
  let json = JSON.stringify(report);
  while (json.length > 512 * 1024 && report.events.length > 1) {
    const removed = Math.ceil(report.events.length / 4);
    report.events.splice(0, removed); report.droppedOnExport += removed; json = JSON.stringify(report);
  }
  if (getPlatformSync() === "android") return withLeaveLockSuppressed(() => invoke<boolean>("terminal_diagnostic_export_android", { json }));
  return saveTextFile("voltius-terminal-trace.json", json);
}
