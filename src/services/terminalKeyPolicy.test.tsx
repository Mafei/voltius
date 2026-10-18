// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutStore, matchShortcut } from "@/stores/shortcutStore";
import { deferTerminalKey, isCompositionKey } from "./terminalKeyPolicy";
import { shortcutsHandler } from "./user-data/handlers/shortcuts";

const terminal = () => {
  const host = document.createElement("div"); host.className = "xterm";
  const input = document.createElement("textarea"); host.append(input); document.body.append(host); input.focus();
  return input;
};
function event(target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(e); return e;
}
beforeEach(() => { useShortcutStore.getState().resetAll(); useUIStore.setState({ omniOpen: false, activeNav: "terminal", settingsOpen: false, rightPanelOpen: false }); });
afterEach(() => { cleanup(); document.body.replaceChildren(); });

test("terminal focus passes default Ctrl/Alt combinations, function keys and Ctrl+C even with an explicit override", () => {
  renderHook(() => useKeyboard()); const input = terminal();
  for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }, { altKey: true, shiftKey: true }]) {
    for (const key of ["k", "b", "f", "w", "a"]) expect(event(input, key, modifiers).defaultPrevented).toBe(false);
  }
  expect(event(input, "F1").defaultPrevented).toBe(false);
  expect(useUIStore.getState().omniOpen).toBe(false);
  useShortcutStore.getState().setKey("omni", "c", true, false, false);
  useShortcutStore.getState().setTerminalAllowed("omni", true);
  expect(event(input, "c", { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(useUIStore.getState().omniOpen).toBe(false);
});

test("explicit per-binding terminal opt-in works and reset restores pass-through", () => {
  renderHook(() => useKeyboard()); const input = terminal();
  useShortcutStore.getState().setTerminalAllowed("omni", true);
  expect(event(input, "k", { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(useUIStore.getState().omniOpen).toBe(true);
  useUIStore.setState({ omniOpen: false }); useShortcutStore.getState().reset("omni");
  expect(event(input, "k", { ctrlKey: true }).defaultPrevented).toBe(false);
});

test("normal input editing and composition/dead keys/AltGr never invoke app shortcuts", () => {
  renderHook(() => useKeyboard()); const input = document.createElement("input"); document.body.append(input); input.focus();
  for (const key of ["a", "c", "x", "v", "z", "k"]) expect(event(input, key, { ctrlKey: true }).defaultPrevented).toBe(false);
  const term = terminal(); useShortcutStore.getState().setTerminalAllowed("omni", true);
  const composing = event(term, "k", { ctrlKey: true, isComposing: true }); expect(composing.defaultPrevented).toBe(false);
  for (const key of ["Dead", "Process"]) expect(isCompositionKey(event(term, key))).toBe(true);
  const altGr = event(term, "k", { ctrlKey: true, altKey: true });
  Object.defineProperty(altGr, "getModifierState", { value: (key: string) => key === "AltGraph" });
  expect(deferTerminalKey(altGr, true)).toBe(true); expect(matchShortcut("omni", altGr)).toBe(false);
  expect(useUIStore.getState().omniOpen).toBe(false);
});

test("nonterminal shortcuts remain available, and terminal opt-in survives the existing settings export/import", async () => {
  renderHook(() => useKeyboard()); event(document.body, "k", { ctrlKey: true }); expect(useUIStore.getState().omniOpen).toBe(true);
  useShortcutStore.getState().setTerminalAllowed("omni", true); const exported = shortcutsHandler.export();
  useShortcutStore.getState().resetAll(); await shortcutsHandler.import(exported);
  expect(useShortcutStore.getState().shortcuts.find((s) => s.id === "omni")?.allowInTerminal).toBe(true);
});
