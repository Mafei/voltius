import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import { androidTerminalOwnsFocus, subscribeAndroidTerminalFocus } from "@/services/androidTerminalFocus";

/** xterm 6 has no public proxy-focus API. Adapt this one per-terminal focus
 * getter, guarded by its exact service shape. No DOM focus or cursor-style
 * overrides: xterm keeps DECSCUSR, user preferences and blink handling. */
export function synchronizeAndroidCursorFocus(term: Terminal, sessionId: string): void {
  const addon: ITerminalAddon = {
    activate() {
      const core = (term as any)._core;
      const browser = core?._coreBrowserService, render = core?._renderService;
      const descriptor = browser && Object.getOwnPropertyDescriptor(Object.getPrototypeOf(browser), "isFocused");
      if (!descriptor?.get || typeof render?.handleFocus !== "function" || typeof render?.handleBlur !== "function") return;
      const original = Object.getOwnPropertyDescriptor(browser, "isFocused");
      const doc = term.element!.ownerDocument, win = doc.defaultView!;
      const proxy = () => androidTerminalOwnsFocus(sessionId) && doc.visibilityState !== "hidden" &&
        (!doc.activeElement || doc.activeElement === doc.body || doc.activeElement === term.textarea);
      Object.defineProperty(browser, "isFocused", { configurable: true, get: () => proxy() || descriptor.get!.call(browser) });
      let disposed = false;
      const update = () => {
        if (disposed) return;
        const focused = browser.isFocused;
        // A DOM blur can pause xterm's blink manager during the native handoff;
        // repeat the effective state even if ownership itself did not change.
        focused ? render.handleFocus() : render.handleBlur();
        term.refresh(term.buffer.active.cursorY, term.buffer.active.cursorY);
      };
      const defer = () => queueMicrotask(update);
      const unsubscribe = subscribeAndroidTerminalFocus(update);
      doc.addEventListener("visibilitychange", update);
      doc.addEventListener("focusin", defer); doc.addEventListener("focusout", defer);
      win.addEventListener("focus", defer); win.addEventListener("blur", defer);
      update();
      addon.dispose = () => {
        disposed = true; unsubscribe();
        doc.removeEventListener("visibilitychange", update);
        doc.removeEventListener("focusin", defer); doc.removeEventListener("focusout", defer);
        win.removeEventListener("focus", defer); win.removeEventListener("blur", defer);
        if (original) Object.defineProperty(browser, "isFocused", original); else delete browser.isFocused;
      };
    },
    dispose() {},
  };
  term.loadAddon(addon);
}
