import { useEffect } from "react";
import { useTerminal, getTerminalApi } from "@/hooks/useTerminal";
import MobileTerminalGestures from "@/components/mobile/MobileTerminalGestures";
import { useSessionStore } from "@/stores/sessionStore";
import { useThemeStore } from "@/stores/themeStore";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { nativeFixture } from "./native";
const id = "synthetic-mobile-gestures";
export default function MobileGesturesFixture() {
  useApplyTheme();
  const { attach, fit } = useTerminal({ sessionId: id, sessionType: "local" });
  useEffect(() => {
    const session = { id, connectionName: "Synthetic local shell", title: "Gesture fixture", type: "local" as const, status: "connected" as const };
    useSessionStore.setState({ sessions: [session], activeSessionId: id }); fit();
    const write = async (text: string) => { nativeFixture.write(id, text); await new Promise(r => setTimeout(r, 80)); };
    Object.assign(window, { __mobileGestures: { write, api: () => getTerminalApi(id), inputs: nativeFixture.inputs,
      size: () => useThemeStore.getState().getActiveTheme().terminalFontSize,
      reset: async () => { nativeFixture.inputs.length=0; await write("\x1bc" + Array.from({length:100},(_,i)=>`Synthetic shell line ${i} ①❶㊿ 中文\r\n`).join("")); },
    } });
  }, [fit]);
  return <main><p>Synthetic real xterm/production gestures; local transport simulated. No device/SSH.</p><div className="relative" style={{height:500,width:"100%"}}><div ref={attach} className="absolute inset-0" /><MobileTerminalGestures sessionId={id} active /></div></main>;
}
