import "./terminalChrome.css";
import { terminalChromeFaceStyle } from "./terminalChrome";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { terminalPanelItems } from "./terminalPanelItems";

/** Toggleable quick-access row of terminal panels (mirrors the ⋮ menu). */
export default function MobileTerminalPanelsRow() {
  const { t } = useTranslation();
  const allSessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const push = useMobileNavStore((s) => s.push);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const activeConnId = allSessions.find((s) => s.id === activeSessionId)?.connectionId;
  const isProxmox = useConnectionStore((s) => s.connections.find((c) => c.id === activeConnId)?.distro === "proxmox");
  const items = terminalPanelItems({
    activeSessionId,
    connectionIdOfActive: activeConnId,
    nav: { push, openSheet },
    isProxmox,
  }, t);
  return (
    <div data-mobile-panels-row className="mobile-terminal-chrome mobile-terminal-toolbar mobile-terminal-chrome-scroll overflow-x-auto">
      {items.map((it) => (
        <button key={it.key} data-mobile-panel-quick={it.key} onClick={it.onTap}
          className="mobile-chrome-face mobile-terminal-toolbar-button font-medium"
          style={terminalChromeFaceStyle()}>
          <Icon icon={it.icon} width={15} />{it.label}
        </button>
      ))}
    </div>
  );
}
