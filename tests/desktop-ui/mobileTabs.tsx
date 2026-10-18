import { useEffect } from "react";
import MobileTerminalScreen from "@/components/mobile/screens/MobileTerminalScreen";
import MobileTerminalPanelsRow from "@/components/mobile/MobileTerminalPanelsRow";
import { terminalPanelsVisible } from "@/components/mobile/terminalChromeState";
import { useUIStore } from "@/stores/uiStore";
import MobileExtraKeysRow from "@/components/mobile/MobileExtraKeysRow";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import type { TerminalSession } from "@/types";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { inputMetrics } from "./mobileInput";
import { muxSessionFixture as mux } from "./sessionFixtures";
const cases: TerminalSession[] = [
  mux("short", "mobile-work", "zellij"),
  mux("chinese", "工作会话", "tmux"),
  mux("long", "Synthetic-gjpqy-é-é-very-long-mobile-session-for-ellipsis", "zellij"),
  mux("long-cn", "工作会话", "tmux", "中文-开发环境-流水线-非常长的会话名称-终端-测试数据-合成标签-多窗口-文字省略-开发工作区"),
  mux("renamed", "remote-original", "zellij", "自定义标题 / Renamed gjpqy"),
  { id: "plain", connectionId: "synthetic-plain", connectionName: "Synthetic SSH", title: "Plain shell gjpqy", type: "ssh", status: "connected", sshMode: { kind: "plain" } },
];
const metrics = { activated: [] as string[], closed: [] as string[] };
let simulatedVisualHeight: number | null = null;
function setKeyboard(open: boolean) {
  simulatedVisualHeight = innerHeight - (open ? Math.min(300, Math.round(innerHeight * 0.45)) : 0);
  Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => simulatedVisualHeight ?? innerHeight });
  window.visualViewport?.dispatchEvent(new Event("resize"));
}
function setLayout(layout: string) {
  const sessions = layout === "single-short" ? [cases[0]] : layout === "single-long" ? [cases[2]] : layout === "single-plain" ? [cases[5]] : cases;
  useSessionStore.setState({ sessions, activeSessionId: sessions[0].id,
    setActive: (id) => { metrics.activated.push(id); useSessionStore.setState({ activeSessionId: id }); },
    disconnect: async (id) => {
      metrics.closed.push(id);
      useSessionStore.setState((state) => ({ sessions: state.sessions.filter((session) => session.id !== id) }));
    } });
  useMobileNavStore.setState({ tab: "terminal" });
}
/** Real production mobile terminal screen/chrome; only native/store effects are synthetic. */
export default function MobileTabFixture() {
  useApplyTheme();
  const { usableHeight, keyboardVisible } = useVisualViewport();
  const panelsNormal = useUIStore((s) => s.terminalPanelsRowOpen);
  const panelsKeyboard = useUIStore((s) => s.terminalPanelsRowKeyboardOpen);
  useEffect(() => {
    document.documentElement.dataset.mobileTabFixture = "";
    setLayout("many");
    setKeyboard(false);
    Object.assign(window, { __mobileTabFixture: { setLayout, setKeyboard, metrics, inputMetrics,
      setPanels: (open: boolean) => useUIStore.setState({ terminalPanelsRowOpen: open, terminalPanelsRowKeyboardOpen: open }),
      resetInput: () => { inputMetrics.length = 0; useModifierLatchStore.setState({ ctrl: "off", alt: "off" }); },
      state: () => ({ active: useSessionStore.getState().activeSessionId, tab: useMobileNavStore.getState().tab, ctrl: useModifierLatchStore.getState().ctrl }) } });
    return () => { delete document.documentElement.dataset.mobileTabFixture; };
  }, []);
  return <><main data-mobile-tab-fixture data-keyboard-open={keyboardVisible} className="chrome-frame h-screen w-full flex flex-col overflow-hidden" style={{ height: usableHeight || undefined }}>
    <style>{`
      [data-mobile-tab-fixture] [data-mobile-session-label]{font-size:calc(var(--text-xs) * var(--fixture-font-scale,1))}
      [data-mobile-tab-fixture] :is([data-mobile-extra-keys],[data-mobile-panels-row]) button{font-size:calc(var(--text-xs) * var(--fixture-font-scale,1))}
      /* Before-image emulation: old heights/inherited lines on the same production component. */
      [data-mobile-legacy] [data-mobile-terminal-topbar]{height:2.75rem;min-height:0;border-bottom:1px solid var(--t-border);box-shadow:none}
      [data-mobile-legacy] [data-mobile-session-strip]{height:100%;padding-block:0}
      [data-mobile-legacy] [data-mobile-session-chip]{padding-block:.25rem;flex-shrink:1;border:1px solid var(--t-border);box-shadow:none}
      [data-mobile-legacy] [data-mobile-session-label]{min-height:0;padding-block:0;line-height:var(--text-xs--line-height)}
      [data-mobile-legacy] [data-mobile-session-primary]{line-height:inherit}
      [data-mobile-legacy] [data-mobile-session-secondary]{font-size:calc(10px * var(--fixture-font-scale,1));line-height:inherit}
      [data-mobile-legacy] [data-mobile-session-close]{width:12px;height:12px;min-width:0;min-height:0}
      [data-mobile-legacy] :is([data-mobile-terminal-exit],[data-mobile-terminal-new],[data-mobile-terminal-menu]){height:100%;min-height:0;width:auto;padding-inline:.5rem}
      [data-mobile-legacy] [data-mobile-terminal-notifications]{width:auto}
      [data-mobile-legacy] [data-mobile-terminal-notifications]>div{padding-inline:.25rem}
      [data-mobile-legacy] [data-mobile-terminal-notifications] button{width:2rem;height:2rem;min-width:0;min-height:0;max-width:none}
      [data-mobile-legacy] :is([data-mobile-session-strip],[data-mobile-extra-keys]){scrollbar-width:auto}
      [data-mobile-legacy] :is([data-mobile-session-strip],[data-mobile-extra-keys])::-webkit-scrollbar{display:block;height:.6rem}
      [data-mobile-legacy] [data-mobile-extra-keys]{gap:.25rem;padding:.375rem;border-top:1px solid var(--t-border);box-shadow:none}
      [data-mobile-legacy][data-keyboard-open="false"] [data-mobile-extra-keys]{padding-bottom:env(safe-area-inset-bottom)!important}
      [data-mobile-legacy][data-keyboard-open="true"] [data-mobile-extra-keys]{padding-bottom:.375rem!important}
      [data-mobile-legacy] [data-mobile-extra-keys] button{min-width:2.75rem;min-height:0;padding:.375rem .625rem;line-height:var(--text-xs--line-height)}
    `}</style>
    <MobileTerminalScreen />
    <div data-mobile-terminal-viewport className="relative flex-1 min-h-0 bg-(--t-bg-terminal) text-(--t-text-primary)">
      <div className="absolute inset-0 overflow-hidden p-3 text-[12px]">
        <p>Synthetic Android mobile layout fixture.</p>
        <p>No real SSH, user host, screenshot or credentials.</p>
      </div>
    </div>
    {terminalPanelsVisible(panelsNormal, panelsKeyboard, keyboardVisible) && <MobileTerminalPanelsRow />}
    <MobileExtraKeysRow keyboardOpen={keyboardVisible} />
  </main>{keyboardVisible && <div data-simulated-ime className="fixed bottom-0 left-0 w-full bg-slate-800 text-white p-2" style={{ height: innerHeight - usableHeight }}>Simulated IME viewport inset — no OS keyboard.</div>}</>;
}
