// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({ invoke: vi.fn(async () => [{ nativeReceived: 10, nativeOutput: 20, bytes: "SECRET" }] as unknown), save: vi.fn(async (_name: string, _content: string) => true) }));
vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/hooks/useTerminal", () => ({ terminalDiagnosticState: () => ({ connected: true, cols: 80, rows: 24, renderer: 2 }) }));
vi.mock("./sessionInput", () => ({ terminalInputQueueState: () => ({ queued: 0, latency: 0 }) }));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: { getState: () => ({ sessions: [{ id: "PRIVATE-ID", connectionName: "alice@10.0.0.1" }], activeSessionId: "PRIVATE-ID" }) } }));
vi.mock("@/stores/mobileNavStore", () => ({ useMobileNavStore: { getState: () => ({ tab: "terminal" }), subscribe: () => () => {} } }));
vi.mock("@/utils/platform", () => ({ getPlatformSync: () => "macos" }));
vi.mock("./saveFile", () => ({ saveTextFile: h.save }));
vi.mock("./leaveLockSuppression", () => ({ withLeaveLockSuppressed: (f: () => unknown) => f() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.63.1" }));
vi.mock("./androidKeyboard", () => ({ androidKeyboardGeneration: () => 1 }));
vi.mock("@/stores/appLockStore", () => ({ useAppLockStore: { getState: () => ({ kind: null }) } }));
import { exportTerminalTrace, installTerminalTraceObservers, markTerminalProblem } from "./terminalDiagnosticReport";
import { terminalTrace } from "./terminalTrace";
test("lifecycle sampling stays in memory; explicit marking/export includes no identifiers or contents", async () => {
  const stop = installTerminalTraceObservers();
  window.dispatchEvent(new Event("resize")); document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus"));
  expect(h.invoke).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  markTerminalProblem("input"); markTerminalProblem("render");
  expect(terminalTrace.snapshot().some((e) => e.kind === "marker_input")).toBe(true);
  expect(await exportTerminalTrace()).toBe(true);
  const content = h.save.mock.calls[0][1];
  for (const secret of ["PRIVATE-ID", "alice", "10.0.0.1", "SECRET"]) expect(content).not.toContain(secret);
  const json = JSON.parse(content); expect(json.version).toBe("0.63.1"); expect(json.events.some((e: { kind: string }) => e.kind === "marker_render")).toBe(true);
  stop();
});
