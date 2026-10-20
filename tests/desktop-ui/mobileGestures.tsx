import { useEffect, useState } from "react";
import { useTerminal, getTerminalApi, sessionAcceptsInput, terminalClipboardAction } from "@/hooks/useTerminal";
import MobileTerminalGestures from "@/components/mobile/MobileTerminalGestures";
import { useSessionStore } from "@/stores/sessionStore";
import { useThemeStore } from "@/stores/themeStore";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { nativeFixture } from "./native";
import { useUIStore } from "@/stores/uiStore";
import MobileExtraKeysRow from "@/components/mobile/MobileExtraKeysRow";
import { clipboardFixture } from "./clipboard";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
const id = "synthetic-mobile-gestures";
export default function MobileGesturesFixture() {
  const [keyboard, setKeyboard] = useState(nativeFixture.keyboardVisible);
  const [active, setActive] = useState(true);
  useApplyTheme();
  const { attach, fit } = useTerminal({ sessionId: id, sessionType: "local" });
  useEffect(() => {
    const session = { id, connectionId: "synthetic-local", connectionName: "Synthetic local shell", title: "Gesture fixture", type: "local" as const, status: "connected" as const };
    useSessionStore.setState({ sessions: [session], activeSessionId: id }); fit();
    const write = async (text: string) => { nativeFixture.write(id, text); await new Promise(r => setTimeout(r, 80)); };
    Object.assign(window, { __mobileGestures: { write, api: () => getTerminalApi(id), inputs: nativeFixture.inputs,
      calls: nativeFixture.calls, keyboard: nativeFixture.setKeyboard.bind(nativeFixture), keyboardVisible: () => nativeFixture.keyboardVisible,
      accepts: () => sessionAcceptsInput(id), pasteDirect: () => terminalClipboardAction(id, "pasteClipboard"),
      active: setActive,
      clipboard: clipboardFixture,
      latches: (on: boolean) => useModifierLatchStore.setState({ ctrl: on ? "locked" : "off", alt: on ? "armed" : "off" }),
      modifierState: () => ({ ctrl: useModifierLatchStore.getState().ctrl, alt: useModifierLatchStore.getState().alt }),
      brackets: (on: boolean) => useToggleSettingsStore.getState().set("ignore-bracketed-paste", !on),
      session: (activeSessionId: string) => useSessionStore.setState({ activeSessionId }),
      configure: (fontSize: number, lineHeight: number) => {
        const theme = { ...useThemeStore.getState().getActiveTheme(), id: "gesture-fixture", terminalFontSize: fontSize, terminalLineHeight: lineHeight };
        useUIStore.setState({ terminalFontSize: null });
        useThemeStore.setState({ mode: "manual", activeThemeId: theme.id, customThemes: [theme] });
      },
      size: () => useThemeStore.getState().getActiveTheme().terminalFontSize,
      reset: async () => { nativeFixture.inputs.length=0; await write("\x1bc" + Array.from({length:100},(_,i)=>`Synthetic shell line ${i} ①❶㊿ 中文\r\n`).join("")); },
    } });
    const onKeyboard = () => { setKeyboard(nativeFixture.keyboardVisible); window.visualViewport?.dispatchEvent(new Event("resize")); };
    window.addEventListener("fixture-keyboard", onKeyboard);
    return () => window.removeEventListener("fixture-keyboard", onKeyboard);
  }, [fit]);
  useEffect(() => { fit(); }, [keyboard, fit]);
  return <main><p>Synthetic real xterm/production gestures; local transport and IME simulated. No device/SSH.</p><div data-gesture-viewport className="relative" style={{height:keyboard ? 340 : 500,width:"100%"}}><div ref={attach} className="absolute inset-0" /><MobileTerminalGestures sessionId={id} active={active} /></div><MobileExtraKeysRow keyboardOpen={keyboard} /></main>;
}
