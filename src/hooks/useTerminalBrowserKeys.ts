import { useEffect } from "react";
import { invoke } from "@/lib/invoke";
import { getPlatform } from "@/utils/platform";
import { isTerminalElement } from "@/services/terminalKeyPolicy";

/** WebView2 browser Find/Reload accelerators are independent of DOM handlers.
 * Serialize focus updates so a late IPC cannot restore browser keys over terminal focus.
 * This changes only this app's WebView2 settings, never OS/global key registration.
 */
export function useTerminalBrowserKeys() {
  useEffect(() => {
    let live = true, windows = false, desired = false, applied: boolean | undefined, running = false;
    const drain = async () => {
      if (!windows || running) return;
      running = true;
      try {
        while (applied !== desired) {
          const current = desired;
          await invoke("terminal_browser_keys", { terminalFocused: current });
          applied = current;
        }
      } catch (error) { console.warn("terminal browser accelerator policy", error); }
      finally { running = false; }
    };
    const update = () => {
      desired = live && document.hasFocus() && isTerminalElement(document.activeElement);
      void drain();
    };
    const focus = () => queueMicrotask(update);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    void getPlatform().then((platform) => { windows = platform === "windows"; update(); });
    return () => {
      live = false;
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      desired = false; void drain();
    };
  }, []);
}
