import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { claimWebglRenderer } from "@/utils/webglAddon";
import { synchronizeAndroidCursorFocus } from "@/utils/androidCursorFocus";
import { setAndroidTerminalTarget, setAndroidTerminalProxyFocus } from "@/services/androidTerminalFocus";

/** Actual production adapter/xterm renderer; native focus callbacks are simulated. */
export default function AndroidCursorFixture() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = new Terminal({ cols: 40, rows: 8, cursorStyle: "bar", cursorBlink: false, allowProposedApi: true });
    term.open(host.current!); claimWebglRenderer(term); synchronizeAndroidCursorFocus(term, "synthetic-cursor");
    const core = (term as any)._core;
    const next = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
    const state = () => ({ focused: core._coreBrowserService.isFocused,
      cursor: core._renderService._renderer.value._model.cursor?.style,
      blink_enabled: !!core._renderService._renderer.value._cursorBlinkStateManager.value,
      blink_paused: core._renderService._renderer.value._cursorBlinkStateManager.value?.isPaused ?? null,
      user_style: term.options.cursorStyle, remote_style: core.coreService.decPrivateModes.cursorStyle ?? null,
      dom_terminal_focus: document.activeElement === term.textarea });
    Object.assign(window, { __androidCursorFixture: { run: async () => {
      const results: Record<string, unknown>[] = [];
      await write("Synthetic cursor / 中文\r\n> ");
      for (const [sequence, expected] of [["\x1b[0 q", "bar"], ["\x1b[2 q", "block"], ["\x1b[4 q", "underline"], ["\x1b[6 q", "bar"]]) {
        await write(sequence);
        setAndroidTerminalProxyFocus(false); term.focus(); await next();
        results.push({ phase: "dom-focused", expected, ...state() });
        term.blur(); setAndroidTerminalTarget("synthetic-cursor"); setAndroidTerminalProxyFocus(true); await next();
        results.push({ phase: "native-ime-open", expected, ...state() });
        setAndroidTerminalProxyFocus(false); await next();
        results.push({ phase: "native-ime-closed-blurred", expected: "outline", ...state() });
      }
      setAndroidTerminalProxyFocus(true); setAndroidTerminalTarget("another-session"); await next();
      results.push({ phase: "other-session", expected: "outline", ...state() });
      setAndroidTerminalTarget("synthetic-cursor"); document.querySelector<HTMLInputElement>("[data-cursor-other-input]")!.focus(); await next();
      results.push({ phase: "other-dom-editor", expected: "outline", ...state() });
      term.options.cursorStyle = "underline"; await write("\x1b[0 q");
      document.querySelector<HTMLInputElement>("[data-cursor-other-input]")!.blur(); setAndroidTerminalProxyFocus(true); await next();
      results.push({ phase: "user-style-reset", expected: "underline", ...state() });
      await write("\x1b[5 q"); await next();
      results.push({ phase: "remote-blinking-bar", expected: "bar", ...state() });
      setAndroidTerminalProxyFocus(false); await next();
      results.push({ phase: "remote-blink-blurred", expected: "outline", ...state() });
      // The native composition editor remains independent; no adapter call to
      // focus() occurs in the proxy paths above.
      setAndroidTerminalProxyFocus(false);
      return { scope: "Normally sandboxed browser, actual xterm/WebGL and production adapter; native IME focus is simulated, no Android device.", results };
    } } });
    return () => { setAndroidTerminalProxyFocus(false); setAndroidTerminalTarget(null); term.dispose(); };
  }, []);
  return <main className="p-4"><p>Synthetic Android terminal focus test</p><input data-cursor-other-input aria-label="Other editor" /><div ref={host} /></main>;
}
