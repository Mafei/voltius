/**
 * Android native soft-keyboard bridge for the terminal (issue #34).
 *
 * xterm.js's own IME path corrupts terminal input on Android (reordered/duplicated chars,
 * deletes that reinsert composed text). Instead a native overlay owns the IME and forwards
 * clean input here via two globals it calls with `evaluateJavascript`:
 *   - `window.__voltiusTermInput(text, ctrl)` — committed characters, `ctrl` while Volume Down is held
 *   - `window.__voltiusTermKey(name)`  — semantic keys (Enter, Backspace, arrows, …)
 * We route them into the active session exactly like the on-screen extra-keys row, honoring the
 * Ctrl/Alt latch and application-cursor mode. `showAndroidKeyboard` / `hideAndroidKeyboard`
 * drive the native overlay (Rust `terminal_show/hide_keyboard` → `TerminalKeyboard.kt`).
 */
import { invoke } from "@/lib/invoke";
import { writeToSession } from "@/hooks/useTerminal";
import { sendSpecialKey } from "@/services/terminalInput";
import { consumeLatchForChar } from "@/stores/modifierLatchStore";
import type { SpecialKey } from "@/services/terminalKeyCore";
import { useAppLockStore } from "@/stores/appLockStore";
import { setAndroidTerminalTarget, setAndroidTerminalProxyFocus } from "./androidTerminalFocus";
import { getToggle } from "@/stores/toggleSettingsStore";
import { orderedOperation } from "./orderedOperations";
import { traceTerminal, type TraceFields } from "./terminalTrace";

/** Session whose terminal currently owns the native keyboard. */
let activeSession: string | null = null;
let installed = false;
// A fresh WebView must not reuse the previous document's queued IME epoch.
let generation = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
export const androidKeyboardGeneration = () => generation;
function keyboardCommand(command: string, args: Record<string, unknown>) {
  void orderedOperation("android-keyboard", () => invoke(command, args)).catch(() => {
    traceTerminal(activeSession, "native_state", { errors: 1, epoch: generation });
  });
}
function acceptsGeneration(epoch?: number): boolean {
  if (epoch === undefined || epoch === generation) return true;
  traceTerminal(activeSession, "native_stale", { epoch: epoch, result: false }); return false;
}

/** Named keys the native side forwards that map onto xterm SpecialKeys (cursor-mode aware). */
const SPECIAL: Partial<Record<string, SpecialKey>> = {
  Left: "Left", Right: "Right", Up: "Up", Down: "Down",
  Home: "Home", End: "End", Tab: "Tab", Esc: "Esc",
  PgUp: "PgUp", PgDn: "PgDn", ShiftTab: "ShiftTab",
};

/** Committed text from the IME. Mirrors the onData path: single chars pass through the
 *  extra-keys Ctrl/Alt latch (latch Ctrl, type "c" → Ctrl-C). */
function feedText(text: string, heldCtrl = false, epoch?: number): void {
  if (!acceptsGeneration(epoch)) return;
  const id = activeSession;
  if (!id || !text || isLocked()) return;
  traceTerminal(id, "input_received", { bytes: new TextEncoder().encode(text).length, epoch: generation });
  let data = text;
  if (text.length === 1) {
    const latched = consumeLatchForChar(text, heldCtrl);
    if (latched !== null) data = latched;
  }
  writeToSession(id, data);
}

/** Semantic key from the IME. Enter/Backspace/Delete are cursor-mode-independent raw bytes;
 *  the rest defer to sendSpecialKey (which honors application-cursor mode). */
function feedKey(name: string, epoch?: number): void {
  if (!acceptsGeneration(epoch)) return;
  const id = activeSession;
  if (!id || isLocked()) return;
  if (name === "Enter") { writeToSession(id, "\r"); return; }
  if (name === "Backspace") { writeToSession(id, "\x7f"); return; }
  if (name === "Delete") { writeToSession(id, "\x1b[3~"); return; }
  const sk = SPECIAL[name];
  if (sk) sendSpecialKey(id, sk, { ctrl: false, alt: false });
}

// The native IME writes through evaluateJavascript, past the lock overlay's DOM guards.
const isLocked = () => useAppLockStore.getState().kind !== null;

function ensureInstalled(): void {
  if (installed) return;
  installed = true;
  useAppLockStore.subscribe((s, prev) => {
    if (s.kind && !prev.kind) hideAndroidKeyboard();
  });
  const w = window as unknown as Record<string, unknown>;
  w.__voltiusTermInput = feedText;
  w.__voltiusTermKey = feedKey;
  w.__voltiusTermFocus = (focused: boolean, epoch?: number) => {
    if (!acceptsGeneration(epoch)) return;
    traceTerminal(activeSession, "focus", { focused, epoch: generation });
    setAndroidTerminalProxyFocus(focused === true && !isLocked());
  };
  w.__voltiusTermDiagnostic = (code: number, fields: TraceFields, epoch: number) => {
    if (!acceptsGeneration(epoch)) return;
    traceTerminal(activeSession, code === 1 ? "input_native" : "native_state", { ...fields, epoch });
  };
}

/** Raise the native keyboard for `sessionId` and route subsequent IME input to it. */
export function showAndroidKeyboard(sessionId: string): void {
  ensureInstalled();
  setAndroidKeyboardTarget(sessionId);
  keyboardCommand("terminal_show_keyboard", { volumeCtrl: getToggle("volume-down-ctrl") });
}

/** Explicit dismissal only. Terminal selection must not call this: it keeps IME ownership. */
export function hideAndroidKeyboard(sessionId?: string, focusWebView = false): void {
  if (sessionId && activeSession !== sessionId) return;
  setAndroidTerminalProxyFocus(false);
  setAndroidKeyboardTarget(null);
  keyboardCommand("terminal_hide_keyboard", { focusWebView });
}

/** Native finger reports for selection autoscroll. */
export function setSelectionTouchFeed(on: boolean): void {
  void invoke("terminal_selection_touch_feed", { on }).catch(() => {});
}

/** Point native input at a session without toggling keyboard visibility (e.g. tab switch). */
export function setAndroidKeyboardTarget(sessionId: string | null): void {
  ensureInstalled();
  if (activeSession === sessionId) return;
  activeSession = sessionId;
  generation++;
  setAndroidTerminalTarget(sessionId);
  keyboardCommand("terminal_keyboard_target", { generation });
}
