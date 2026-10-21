import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import NewSessionSheet from "./sheets/NewSessionSheet";
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  // Keep the active chip on screen when the session or the chip list changes (swipe, new
  // session, close). Measured on the next frame, once the new chip has its final width.
  const chipKey = sessions.map((x) => `${x.id}:${x.status}`).join(",");
  useEffect(() => {
    if (!activeSessionId) return;
    const raf = requestAnimationFrame(() => {
      const chips = chipsRef.current?.children ?? [];
      const chip = [...chips].find((el) => (el as HTMLElement).dataset.mobileSessionChip === activeSessionId);
      chip?.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeSessionId, chipKey]);
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
      className="shrink-0 flex items-center h-11 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      <button
        data-mobile-terminal-exit
        onClick={() => setTab(exitTo)}
        className="px-2 h-full text-(--t-text-primary) shrink-0"
        aria-label={t("mobile.terminalTopBar.exitAriaLabel")}
      >
        <Icon icon="lucide:chevron-left" width={22} />
      </button>
      <div ref={chipsRef} data-mobile-session-chips className="flex-1 flex items-center gap-1.5 overflow-x-auto px-1 h-full scrollbar-none">
        {sessions.map((s) => {
          const active = s.id === activeSessionId;
          return (
            <span
              key={s.id}
              data-mobile-session-chip={s.id}
              className="shrink-0 flex items-center gap-1.5 rounded-full pl-2.5 pr-1 h-8 text-xs font-medium whitespace-nowrap"
              style={{
                background: active ? "var(--t-accent)" : "var(--t-bg-card)",
                color: active ? "#fff" : "var(--t-text-primary)",
                border: "1px solid var(--t-border)",
              }}
            >
              <StatusDot tone={sessionStatusTone(s.status)} size="sm" />
              <button onClick={() => setActive(s.id)}>{sessionLabel(s)}</button>
              <button data-mobile-session-close={s.id} onClick={() => void disconnect(s.id)} className="opacity-70 h-8 w-6 flex items-center justify-center">
                <Icon icon="lucide:x" width={12} />
              </button>
            </span>
          );
        })}
      </div>
      <button
        data-mobile-terminal-new
        onClick={() => setPickerOpen(true)}
        className="px-2 h-full text-(--t-text-primary) shrink-0"
        aria-label={t("mobile.terminalTopBar.newSessionAriaLabel")}
      >
        <Icon icon="lucide:plus" width={20} />
      </button>
      {pickerOpen && <NewSessionSheet onClose={() => setPickerOpen(false)} />}
      <NotificationBell />
      <div className="shrink-0">
        <button
          ref={menuButtonRef}
          data-mobile-terminal-menu
          onClick={() => setMenuOpen((v) => !v)}
          className="px-2 h-full text-(--t-text-primary)"
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
