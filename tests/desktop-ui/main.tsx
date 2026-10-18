import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "@/i18n";
import "@/styles/globals.css";
import SessionConnectionForm from "@/components/connections/SessionConnectionForm";
import { handleTerminalKeyEvent } from "@/hooks/useTerminal";
import { attachTerminalClipboard } from "@/components/terminal/terminalClipboard";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutStore } from "@/stores/shortcutStore";
import { metrics } from "./picker";
import type { Connection } from "@/types";
import TabLabelFixture from "./tabLabels";

const host = { id: "synthetic-desktop-ui", name: "Synthetic test host", host: "example.invalid", port: 22, username: "alice" } as Connection;
const data: string[] = [];
function App() {
  useKeyboard(); useApplyTheme();
  const [chooser, setChooser] = useState(true), [opened, setOpened] = useState("");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    useUIStore.setState({ activeNav: "terminal", omniOpen: false, rightPanelOpen: false });
    const term = new Terminal({ rows: 12, cols: 75, allowProposedApi: true }); term.open(container.current!);
    const clip = attachTerminalClipboard(term, container.current!);
    term.attachCustomKeyEventHandler((event) => handleTerminalKeyEvent("synthetic-terminal", event, clip));
    const input = term.onData((value) => data.push(value)); term.write("Synthetic local browser terminal\r\nNo SSH or credentials are used.\r\n");
    Object.assign(window, { __desktopTest: { data, metrics, term, state: () => ({ omniOpen: useUIStore.getState().omniOpen, rightPanelOpen: useUIStore.getState().rightPanelOpen }),
      allow: (id: string, allowed: boolean) => useShortcutStore.getState().setTerminalAllowed(id, allowed),
      reset: () => { data.length = 0; useUIStore.setState({ omniOpen: false, rightPanelOpen: false }); } } });
    return () => { input.dispose(); clip.dispose(); term.dispose(); };
  }, []);
  return <div className="chrome-frame h-screen p-6">
    <h1 className="text-xl">Desktop session and keyboard UI verification</h1>
    <p>Browser fixture: simulated SSH listing; real shared form, shortcut handlers and xterm.</p>
    <button onClick={() => setChooser(true)}>Choose connection</button><p data-opened>{opened}</p>
    <label>Ordinary input<input aria-label="Ordinary input" defaultValue="editing" className="form-input" /></label>
    <div ref={container} className="mt-4 border rounded p-2" />
    {chooser && <SessionConnectionForm connection={host} presentation="dialog" onClose={() => setChooser(false)} onOpened={(id) => { setOpened(id); setChooser(false); }} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).has("tab-labels") ? <TabLabelFixture /> : <App />);
