import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { useUIStore } from "@/stores/uiStore";
import { useMobilePasteConfirmStore } from "@/stores/mobilePasteConfirmStore";
import { keyToBytes } from "@/services/terminalKeyCore";

const h = vi.hoisted(() => ({ send: vi.fn(), paste: vi.fn(async () => {}) }));
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: h.send }));
vi.mock("@/hooks/useTerminal", () => ({ terminalClipboardAction: h.paste }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }), initReactI18next: { type: "3rdParty", init: () => {} } }));
import MobileExtraKeysRow from "./MobileExtraKeysRow";

beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockReset();
  useMobilePasteConfirmStore.getState().finish(false);
  useSessionStore.setState({ activeSessionId: "synthetic-mobile" });
  useModifierLatchStore.setState({ ctrl: "off", alt: "off" });
  useUIStore.setState({ terminalPanelsRowOpen: false, terminalPanelsRowKeyboardOpen: undefined });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
const touch = (node: HTMLElement, start = 20, end = start) => {
  fireEvent.touchStart(node, { touches: [{ clientX: start, clientY: 20 }] });
  fireEvent.touchEnd(node, { changedTouches: [{ clientX: end, clientY: 20 }] });
};

test("a touch tap sends one key and the following synthetic click never repeats it", () => {
  render(<MobileExtraKeysRow />);
  const key = screen.getByRole("button", { name: "Esc" }); touch(key); fireEvent.click(key, { detail: 1 });
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.send).toHaveBeenCalledWith("synthetic-mobile", "Esc", { ctrl: false, alt: false });
});
test("keyboard and assistive click activation remains usable on a touch-capable window", () => {
  render(<MobileExtraKeysRow />);
  fireEvent.click(screen.getByRole("button", { name: "Ctrl" }), { detail: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Esc" }), { detail: 0 });
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.send).toHaveBeenCalledWith("synthetic-mobile", "Esc", { ctrl: true, alt: false });
});
test("a horizontal drag or cancelled touch never sends a key", () => {
  render(<MobileExtraKeysRow />);
  const key = screen.getByRole("button", { name: "Tab" }); touch(key, 20, 80);
  fireEvent.touchStart(key, { touches: [{ clientX: 20, clientY: 20 }] }); fireEvent.touchCancel(key);
  fireEvent.touchEnd(key, { changedTouches: [{ clientX: 20, clientY: 20 }] });
  expect(h.send).not.toHaveBeenCalled();
});
test("a short modifier tap is consumed once, while a long press remains locked", () => {
  vi.useFakeTimers(); render(<MobileExtraKeysRow />);
  const ctrl = screen.getByRole("button", { name: "Ctrl" }), esc = screen.getByRole("button", { name: "Esc" });
  touch(ctrl); expect(ctrl.getAttribute("aria-pressed")).toBe("true"); touch(esc);
  expect(h.send).toHaveBeenLastCalledWith("synthetic-mobile", "Esc", { ctrl: true, alt: false });
  expect(useModifierLatchStore.getState().ctrl).toBe("off");
  fireEvent.touchStart(ctrl, { touches: [{ clientX: 20, clientY: 20 }] });
  act(() => { vi.advanceTimersByTime(451); }); fireEvent.touchEnd(ctrl);
  expect(useModifierLatchStore.getState().ctrl).toBe("locked"); touch(esc);
  expect(useModifierLatchStore.getState().ctrl).toBe("locked");
});
test("scroll cancellation clears a pending modifier long press", () => {
  vi.useFakeTimers(); render(<MobileExtraKeysRow />);
  const alt = screen.getByRole("button", { name: "Alt" }); fireEvent.touchStart(alt); fireEvent.touchCancel(alt);
  act(() => { vi.advanceTimersByTime(500); }); expect(useModifierLatchStore.getState().alt).toBe("off");
});
test("touch preserves keyboard-open focus and blurs it only when the keyboard is closed", () => {
  const view = render(<><input aria-label="synthetic terminal" /><MobileExtraKeysRow keyboardOpen={false} /></>);
  const input = screen.getByLabelText("synthetic terminal"); input.focus();
  fireEvent.touchStart(screen.getByRole("button", { name: "Esc" })); expect(document.activeElement).not.toBe(input);
  view.rerender(<><input aria-label="synthetic terminal" /><MobileExtraKeysRow keyboardOpen /></>); input.focus();
  fireEvent.touchStart(screen.getByRole("button", { name: "Esc" })); expect(document.activeElement).toBe(input);
});
test("icon keys and the panel toggle keep accessible names and pressed state", () => {
  render(<MobileExtraKeysRow />);
  for (const name of ["Up", "Down", "Left", "Right"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  const panel = screen.getByRole("button", { name: "mobile.terminalTopBar.panelsAriaLabel" });
  expect(panel.getAttribute("aria-pressed")).toBe("false"); fireEvent.click(panel);
  expect(panel.getAttribute("aria-pressed")).toBe("true");
});

test("keyboard toolbar defaults closed and preserves explicit choices across viewport changes", () => {
  useUIStore.setState({ terminalPanelsRowOpen: true });
  const view = render(<MobileExtraKeysRow keyboardOpen={false} />);
  const toggle = () => screen.getByRole("button", { name: "mobile.terminalTopBar.panelsAriaLabel" });
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  view.rerender(<MobileExtraKeysRow keyboardOpen />);
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle()); expect(toggle().getAttribute("aria-pressed")).toBe("true");
  view.rerender(<MobileExtraKeysRow keyboardOpen={false} />);
  fireEvent.click(toggle()); expect(toggle().getAttribute("aria-pressed")).toBe("false");
  view.rerender(<MobileExtraKeysRow keyboardOpen />);
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
});

test("final row order and actual terminal sequences preserve navigation and literal plus", () => {
  const sent: string[] = [];
  h.send.mockImplementation((_id, key, mods) => sent.push(keyToBytes(key, { ...mods, appCursor: false })));
  const { container } = render(<MobileExtraKeysRow />);
  const order = [...container.querySelectorAll<HTMLElement>("[data-mobile-key]")].map(n => n.dataset.mobileKey);
  const right = order.indexOf("Right");
  expect(order.slice(right + 1, right + 5)).toEqual(["Home", "End", "PgUp", "PgDn"]);
  expect(order).toEqual(["ctrl", "alt", "Esc", "Tab", "Up", "Down", "Left", "Right", "Home", "End", "PgUp", "PgDn", "+", "|", "Paste", "-", "/"]);
  for (const key of ["Home", "End", "PgUp", "PgDn", "+"]) touch(screen.getByRole("button", { name: key }));
  expect(sent).toEqual(["\x1b[H", "\x1b[F", "\x1b[5~", "\x1b[6~", "+"]);
  // Removing buttons must not remove the keyboard/terminal mappings.
  for (const [key, sequence] of [["ShiftTab", "\x1b[Z"], ["~", "~"], ["-", "-"], ["/", "/"]] as const)
    expect(keyToBytes(key, { ctrl: false, alt: false, appCursor: false })).toBe(sequence);
});

test.each([false, true])("Paste uses the shared Ctrl+Shift+V action once without changing latches or keyboard-open=%s focus", keyboardOpen => {
  useModifierLatchStore.setState({ ctrl: "locked", alt: "armed" });
  render(<><input aria-label="terminal focus" /><MobileExtraKeysRow keyboardOpen={keyboardOpen} /></>);
  expect(h.paste).not.toHaveBeenCalled();
  const input = screen.getByLabelText("terminal focus"); input.focus();
  const paste = screen.getByRole("button", { name: "common.action.paste" });
  expect(paste.title).toBe("Ctrl+Shift+V");
  touch(paste); fireEvent.click(paste, { detail: 1 });
  expect(h.paste).toHaveBeenCalledTimes(1);
  expect(h.paste).toHaveBeenCalledWith("synthetic-mobile", "pasteClipboard");
  expect(h.send).not.toHaveBeenCalled();
  expect(useModifierLatchStore.getState()).toMatchObject({ ctrl: "locked", alt: "armed" });
  if (keyboardOpen) expect(document.activeElement).toBe(input);
  act(() => { useSessionStore.setState({ activeSessionId: "new-session" }); }); touch(paste);
  expect(h.paste).toHaveBeenLastCalledWith("new-session", "pasteClipboard");
});

test("multiline confirmation neither focuses an input nor survives a session switch", async () => {
  const view = render(<><input aria-label="terminal focus" /><MobileExtraKeysRow keyboardOpen /></>);
  const input = screen.getByLabelText("terminal focus"); input.focus();
  let answer!: Promise<boolean>;
  act(() => { answer = useMobilePasteConfirmStore.getState().request("synthetic-mobile", "你好\necho test\n"); });
  expect(screen.getByRole("alertdialog")).toBeTruthy(); expect(document.activeElement).toBe(input);
  act(() => { useSessionStore.setState({ activeSessionId: "new-session" }); });
  expect(await answer).toBe(false); expect(screen.queryByRole("alertdialog")).toBeNull();
  view.unmount();
});
