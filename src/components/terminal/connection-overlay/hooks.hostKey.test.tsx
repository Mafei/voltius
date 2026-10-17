import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({ listen: vi.fn(), resolve: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
vi.mock("@/services/knownHosts", () => ({ resolveKnownHostConflict: h.resolve }));
import { useHostKeyConflict } from "./hooks";
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test("a picker can wait for its trust listener before starting a handshake", async () => {
  let listening!: (unlisten: () => void) => void;
  let receive!: (event: { payload: Record<string, unknown> }) => void;
  const stop = vi.fn();
  h.listen.mockImplementation((_name, callback) => { receive = callback; return new Promise((resolve) => { listening = resolve; }); });
  const hook = renderHook(() => useHostKeyConflict({ sessionId: "picker", status: "connecting", conflictEventName: "ssh-host-key-conflict-picker" }));
  expect(hook.result.current.listening).toBe(false);
  await act(async () => listening(stop));
  await waitFor(() => expect(hook.result.current.listening).toBe(true));
  act(() => receive({ payload: { session_id: "another-tab" } })); expect(hook.result.current.conflict).toBeNull();
  act(() => receive({ payload: { session_id: "picker", host: "example.test", port: 22, stored_entries: [], new_fingerprint: "synthetic" } }));
  expect(hook.result.current.conflict?.host).toBe("example.test"); expect(h.resolve).not.toHaveBeenCalled();
  await act(async () => hook.result.current.resolveConflict("abort"));
  expect(h.resolve).toHaveBeenCalledWith("picker", "abort");
  hook.unmount(); await Promise.resolve(); expect(stop).toHaveBeenCalled();
});
