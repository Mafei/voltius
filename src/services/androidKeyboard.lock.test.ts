// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ write: vi.fn(), invoke: vi.fn(async (..._args: unknown[]) => undefined) }));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/hooks/useTerminal", () => ({ writeToSession: h.write }));
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: vi.fn() }));
vi.mock("@/stores/modifierLatchStore", () => ({ consumeLatchForChar: () => null }));
vi.mock("@/services/account", () => ({ getAppLock: async () => null, setAppLock: async () => {} }));

import { showAndroidKeyboard, hideAndroidKeyboard, setAndroidKeyboardTarget, androidKeyboardGeneration } from "./androidKeyboard";
import { androidTerminalOwnsFocus } from "./androidTerminalFocus";
import { useAppLockStore } from "@/stores/appLockStore";

const w = window as unknown as { __voltiusTermInput: (t: string, ctrl?: boolean, epoch?: number) => void; __voltiusTermKey: (k: string, epoch?: number) => void; __voltiusTermFocus: (v: boolean, epoch?: number) => void };

beforeEach(async () => {
  vi.clearAllMocks();
  useAppLockStore.setState({ kind: null });
  showAndroidKeyboard("s1");
  await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledWith("terminal_show_keyboard", { volumeCtrl: false }));
});

test("native keyboard input reaches the session when unlocked", () => {
  w.__voltiusTermInput("a");
  expect(h.write).toHaveBeenCalledWith("s1", "a");
});

test("native keyboard input never reaches the session behind the lock screen", () => {
  useAppLockStore.setState({ kind: "screen" });
  w.__voltiusTermInput("rm -rf /");
  w.__voltiusTermKey("Enter");
  expect(h.write).not.toHaveBeenCalled();
});

test("locking the screen dismisses the native keyboard", async () => {
  await useAppLockStore.getState().lockScreen();
  await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledWith("terminal_hide_keyboard", { focusWebView: false }));
});

test("native proxy ownership follows the active session and ignores an inactive view's hide", () => {
  w.__voltiusTermFocus(true); expect(androidTerminalOwnsFocus("s1")).toBe(true);
  setAndroidKeyboardTarget("s2"); hideAndroidKeyboard("s1");
  expect(androidTerminalOwnsFocus("s2")).toBe(true);
  expect(h.invoke.mock.calls.filter(([command]) => command === "terminal_hide_keyboard")).toHaveLength(0);
  w.__voltiusTermFocus(false); expect(androidTerminalOwnsFocus("s2")).toBe(false);
});


test("native selection focus handoff preserves session ownership and clears only active proxy focus", async () => {
  setAndroidKeyboardTarget("s2"); w.__voltiusTermFocus(true);
  hideAndroidKeyboard("s1", true);
  expect(h.invoke.mock.calls.filter(([command]) => command === "terminal_hide_keyboard")).toHaveLength(0);
  expect(androidTerminalOwnsFocus("s2")).toBe(true);
  hideAndroidKeyboard("s2", true);
  await vi.waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith("terminal_hide_keyboard", { focusWebView: true }));
  expect(androidTerminalOwnsFocus("s2")).toBe(false);
});

test("queued native text, key and focus from session A cannot reach B or a hidden terminal", () => {
  const epoch = androidKeyboardGeneration();
  setAndroidKeyboardTarget("s2");
  w.__voltiusTermInput("synthetic", false, epoch); w.__voltiusTermKey("Enter", epoch); w.__voltiusTermFocus(true, epoch);
  expect(h.write).not.toHaveBeenCalled(); expect(androidTerminalOwnsFocus("s2")).toBe(false);
  const current = androidKeyboardGeneration();
  w.__voltiusTermInput("ok", false, current); expect(h.write).toHaveBeenCalledWith("s2", "ok");
  h.write.mockClear(); hideAndroidKeyboard("s2");
  w.__voltiusTermInput("late", false, current); expect(h.write).not.toHaveBeenCalled();
});
