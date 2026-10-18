import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useKeyboard } from "@/hooks/useKeyboard";
import { handleTerminalKeyEvent } from "@/hooks/useTerminal";
import { useShortcutStore } from "@/stores/shortcutStore";
import { useUIStore } from "@/stores/uiStore";
import { getPlatform } from "@/utils/platform";
import { createTerminal, write, emit, nextFrame } from "./support";
import "@/i18n";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

async function nativeKeys(keys: string[]) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("Native key dispatch timed out")), 10000);
    (window as any).__terminalKeysAck = () => { clearTimeout(timeout); resolve(); };
    emit({ phase: "native-keys", keys });
  });
}
function App() {
  useKeyboard(); const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = createTerminal(host.current!, { cols: 80, rows: 16 });
    const data: string[] = [], decisions: Record<string, unknown>[] = [];
    const input = term.onData((value) => data.push(value));
    term.attachCustomKeyEventHandler((event) => {
      const allowed = handleTerminalKeyEvent("synthetic-native-keyboard", event);
      decisions.push({ key: event.key, code: event.code, keyCode: event.keyCode, type: event.type, ctrl: event.ctrlKey, meta: event.metaKey, is_trusted: event.isTrusted, allowed }); return allowed;
    });
    async function run() {
      const platform = await getPlatform();
      useShortcutStore.getState().resetAll(); useUIStore.setState({ activeNav: "terminal" });
      await write(term, "Synthetic native keyboard byte capture\r\nNo SSH host, credentials or user content.\r\n"); await nextFrame();
      const results: Record<string, any>[] = [];
      async function capture(label: string, keys: string[], allowed = false) {
        useShortcutStore.getState().setTerminalAllowed("sidebar", allowed);
        data.length = 0; decisions.length = 0; const before = useUIStore.getState().sidebarOpen;
        term.focus(); await nativeKeys(keys); await nextFrame();
        const bytes = [...new TextEncoder().encode(data.join(""))];
        const result = { label, bytes, hex: bytes.map((x) => x.toString(16).padStart(2, "0")).join(" "), decisions: [...decisions], sidebar_opt_in: allowed,
          sidebar_toggled: before !== useUIStore.getState().sidebarOpen };
        results.push(result); emit({ phase: "keyboard-case", ...result });
      }
      await capture("default-ctrl-b", ["ctrl-b"]);
      await capture("default-ctrl-enter", ["ctrl-enter"]);
      await capture("default-enter", ["enter"]);
      await capture("default-ctrl-g", ["ctrl-g"]);
      data.length = 0; await write(term, "\x1b[?u"); await nextFrame(); await nextFrame();
      const queryResponse = [...new TextEncoder().encode(data.join(""))];
      await write(term, "\x1b[>1u"); await capture("ctrl-enter-after-kitty-request", ["ctrl-enter"]);
      await capture("explicit-sidebar-opt-in-ctrl-b", ["ctrl-b"], true);
      const expected: Record<string, string> = { "default-ctrl-b": "02", "default-ctrl-enter": "0d", "default-enter": "0d", "default-ctrl-g": "07", "ctrl-enter-after-kitty-request": "0d", "explicit-sidebar-opt-in-ctrl-b": "" };
      const result = { phase: "complete", case: "native-terminal-keyboard", platform, results, kitty_query_response: queryResponse,
        ctrl_enter_distinguishable_from_enter: results[1].hex !== results[2].hex,
        failed_checks: results.filter((r) => r.hex !== expected[r.label]).length,
        scope: "Synthetic AppKit events through WKWebView and production client handlers/xterm. No real user keyboard layout, Tauri menu, SSH server or Zellij configuration is changed. Legacy Ctrl+Enter remains CR; extended protocol support is not claimed." };
      emit(result);
    }
    run().catch((error) => emit({ phase: "error", message: String(error), stack: error?.stack }));
    return () => { input.dispose(); term.dispose(); };
  }, []);
  return <div ref={host} style={{ margin: 16, width: 1000, height: 600 }} />;
}
createRoot(document.getElementById("root")!).render(<App />);
