import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { terminalPanelItems } from "./terminalPanelItems";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";
import { StatusDot } from "@/components/shared/StatusDot";
import { sessionLabel } from "@/utils/sessionLabel";
import { sessionStatusTone } from "@/utils/statusTone";
import "./terminalChrome.css";

const iconButtonClass = "inline-flex size-(--mobile-touch-size) shrink-0 items-center justify-center";

/** Persistent slim terminal chrome: exit chevron / scrollable session tabs / new / panels menu. */
export default function MobileTerminalTopBar() {
  const { t } = useTranslation();
  // Select the raw array (stable ref) and filter in render — a filtering selector
  // returns a fresh array each store update and defeats selector memoization.
  const allSessions = useSessionStore((s) => s.sessions);
  const sessions = allSessions.filter((x) => x.type !== "multiplayer");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActive);
  const disconnect = useSessionStore((s) => s.disconnect);
  const setTab = useMobileNavStore((s) => s.setTab);
  const push = useMobileNavStore((s) => s.push);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const exitTo = useMobileNavStore((s) => s.lastNonTerminalTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Derive Proxmox gate as a primitive (boolean) — Zustand-safe; no fresh array/object from the selector.
  const activeConnId = allSessions.find((s) => s.id === activeSessionId)?.connectionId;
  const isProxmox = useConnectionStore((s) => s.connections.find((c) => c.id === activeConnId)?.distro === "proxmox");

  const panelItems = terminalPanelItems({
    activeSessionId,
    connectionIdOfActive: activeConnId,
    nav: { push, openSheet },
    isProxmox,
  }, t);

  return (
    <div
      data-mobile-terminal-topbar
      className="mobile-terminal-chrome w-full min-w-0 shrink-0 flex items-center min-h-(--mobile-touch-size)"
      style={{ background: "var(--t-bg-chrome)", boxShadow: "inset 0 -1px var(--t-border)" }}
    >
      <button
        data-mobile-terminal-exit
        onClick={() => setTab(exitTo)}
        className={`${iconButtonClass} text-(--t-text-primary)`}
        aria-label={t("mobile.terminalTopBar.exitAriaLabel")}
      >
        <Icon icon="lucide:chevron-left" width={22} />
      </button>
      {/* Intrinsic height includes both text lines at the user's font scale.
          Keep vertical overflow measurable; never crop enlarged text to fit. */}
      <div data-mobile-session-strip className="mobile-terminal-chrome-scroll min-w-0 flex-1 flex items-center gap-[6px] overflow-x-auto px-[4px]">
        {sessions.map((s) => {
          const active = s.id === activeSessionId;
          const primary = sessionLabel(s);
          const secondary = s.sshMode?.kind === "tmux" || s.sshMode?.kind === "zellij"
            ? `${s.sshMode.kind === "tmux" ? "Tmux" : "Zellij"} · ${s.connectionName} · ${s.sshMode.username}@${s.sshMode.endpoint}` : undefined;
          const fullTitle = secondary ? `${primary} · ${secondary}` : `${primary} · ${s.connectionName}`;
          return (
            <span
              key={s.id}
              data-mobile-session-chip={s.id}
              className="min-w-0 max-w-full shrink-0 flex items-center gap-[4px] rounded-full pl-[8px] pr-[2px] font-medium whitespace-nowrap"
              style={{
                background: active ? "var(--t-accent)" : "var(--t-bg-card)",
                color: active ? "#fff" : "var(--t-text-primary)",
                boxShadow: "inset 0 0 0 1px var(--t-border)",
              }}
            >
              <StatusDot tone={sessionStatusTone(s.status)} size="sm" />
              <button data-mobile-session-label onClick={() => setActive(s.id)}
                className="min-w-0 max-w-[16rem] min-h-(--mobile-touch-size) flex-1 flex flex-col justify-center py-[2px] text-left text-xs leading-[1.3]"
                aria-label={fullTitle} aria-pressed={active} title={fullTitle}>
                <span data-mobile-session-primary className="block w-full truncate leading-[1.3]">{primary}</span>
                {secondary && <span data-mobile-session-secondary className="block w-full truncate text-[0.85em] leading-[1.3] opacity-75">{secondary}</span>}
              </button>
              <button data-mobile-session-close={s.id} onClick={() => void disconnect(s.id)} className={`${iconButtonClass} opacity-70`}
                aria-label={`${t("common.action.close")}: ${primary}`}>
                <Icon icon="lucide:x" width={12} />
              </button>
            </span>
          );
        })}
      </div>
      <button
        data-mobile-terminal-new
        onClick={() => setTab("hosts")}
        className={`${iconButtonClass} text-(--t-text-primary)`}
        aria-label={t("mobile.terminalTopBar.newSessionAriaLabel")}
      >
        <Icon icon="lucide:plus" width={20} />
      </button>
      <div data-mobile-terminal-notifications className="flex w-(--mobile-touch-size) shrink-0 justify-center [&>div]:px-0 [&_button]:min-h-(--mobile-touch-size) [&_button]:max-h-(--mobile-touch-size) [&_button]:min-w-(--mobile-touch-size) [&_button]:max-w-(--mobile-touch-size)">
        <NotificationBell />
      </div>
      <div className="shrink-0">
        <button
          ref={menuButtonRef}
          data-mobile-terminal-menu
          onClick={() => setMenuOpen((v) => !v)}
          className={`${iconButtonClass} text-(--t-text-primary)`}
          aria-label={t("mobile.terminalTopBar.panelsAriaLabel")}
        >
          <Icon icon="lucide:ellipsis-vertical" width={20} />
        </button>
        <PickerSurface
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={menuButtonRef}
          title={t("mobile.terminalTopBar.panelsAriaLabel")}
          width="content"
          minWidth="10rem"
          align="right"
        >
          {panelItems.map((it) => (
            <DropdownMenuItem
              key={it.key}
              dataAttrs={{ "data-mobile-panel": it.key }}
              icon={it.icon}
              iconSize={16}
              label={it.label}
              onClick={() => { it.onTap(); setMenuOpen(false); }}
            />
          ))}
        </PickerSurface>
      </div>
    </div>
  );
}
