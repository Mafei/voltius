import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { isActive, type Modifier } from "@/stores/modifierLatchCore";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { sendSpecialKey } from "@/services/terminalInput";
import type { SpecialKey } from "@/services/terminalKeyCore";
import { useUIStore } from "@/stores/uiStore";
import { useTranslation } from "react-i18next";
import "./terminalChrome.css";
import { terminalPanelsVisible } from "./terminalChromeState";

type KeyDef = { key: SpecialKey; label?: string; icon?: string };
const KEYS: KeyDef[] = [
  { key: "Esc", label: "Esc" }, { key: "Tab", label: "Tab" }, { key: "ShiftTab", label: "⇧Tab" },
  { key: "Up", icon: "lucide:arrow-up" }, { key: "Down", icon: "lucide:arrow-down" },
  { key: "Left", icon: "lucide:arrow-left" }, { key: "Right", icon: "lucide:arrow-right" },
  { key: "-", label: "-" }, { key: "/", label: "/" }, { key: "|", label: "|" }, { key: "~", label: "~" },
  { key: "Home", label: "Home" }, { key: "End", label: "End" }, { key: "PgUp", label: "PgUp" }, { key: "PgDn", label: "PgDn" },
];
const MODS: { mod: Modifier; label: string }[] = [ { mod: "ctrl", label: "Ctrl" }, { mod: "alt", label: "Alt" } ];
const keyClass = "mobile-chrome-face shrink-0 min-w-(--mobile-touch-size) min-h-(--mobile-touch-size) px-[6px] py-[2px] rounded-lg text-xs leading-[1.25] whitespace-nowrap flex items-center justify-center";
function clearPressTimer(timer: { current: ReturnType<typeof setTimeout> | null }) {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
}
const keyFace = (background: string, color = "var(--t-text-primary)"): CSSProperties => ({ "--mobile-face-bg": background, color }) as CSSProperties;
// Touchend already handles taps; detail=0 preserves keyboard/assistive activation.
const isActivationClick = (event: React.MouseEvent) => !("ontouchstart" in window) || event.detail === 0;

export default function MobileExtraKeysRow({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const panelsNormal = useUIStore((s) => s.terminalPanelsRowOpen);
  const panelsKeyboard = useUIStore((s) => s.terminalPanelsRowKeyboardOpen);
  const panelsOpen = terminalPanelsVisible(panelsNormal, panelsKeyboard, !!keyboardOpen);
  const togglePanels = useUIStore((s) => s.toggleTerminalPanelsRow);
  const ctrl = useModifierLatchStore((s) => s.ctrl);
  const alt = useModifierLatchStore((s) => s.alt);
  const tap = useModifierLatchStore((s) => s.tap);
  const lock = useModifierLatchStore((s) => s.lock);
  const consume = useModifierLatchStore((s) => s.consume);
  const latch: Record<Modifier, typeof ctrl> = { ctrl, alt };
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null), modsRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true), [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const root = rootRef.current, mods = modsRef.current;
    if (!root || !mods || typeof ResizeObserver === "undefined") return;
    const update = () => { if (root.clientWidth > 0) setPinned(mods.scrollWidth <= root.clientWidth * 0.42); };
    const observer = new ResizeObserver(update); observer.observe(root); observer.observe(mods); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => clearPressTimer(longPressTimer), []);
  // Tap-vs-scroll tracking for KEYS: record the touch origin, only fire on touchend
  // if the finger barely moved (a real tap, not a horizontal scroll-drag of the row).
  const keyTouchStart = useRef<{ x: number; y: number } | null>(null);
  const TAP_MOVE_PX = 10;

  const press = (key: SpecialKey) => {
    if (!activeSessionId) return;
    sendSpecialKey(activeSessionId, key, { ctrl: isActive(latch.ctrl), alt: isActive(latch.alt) });
    consume();
  };
  const tapMod = (mod: Modifier) => tap(mod);
  const lockMod = (mod: Modifier) => lock(mod);
  const noFocusSteal = (e: React.SyntheticEvent) => e.preventDefault();
  // The row must never summon the soft keyboard. The xterm textarea is programmatically focused
  // (Android keeps the IME hidden), so the first touch gesture would otherwise pop the IME for it.
  // When the keyboard is closed, blur the focused element on touch so the tap can't trigger it.
  // Keyboard open: leave focus alone so it stays open for continued typing.
  const keepKeyboardClosed = () => { if (!keyboardOpen) (document.activeElement as HTMLElement | null)?.blur(); };

  return (
    <div ref={rootRef} data-mobile-extra-keys data-modifiers-pinned={pinned} data-mobile-key-scroll={!pinned || undefined}
      className="mobile-terminal-chrome mobile-terminal-chrome-scroll min-w-0 shrink-0 flex items-center gap-[6px] px-[4px]"
      style={{
        overflowX: pinned ? "visible" : "auto",
        background: "var(--t-bg-chrome)", boxShadow: "inset 0 1px var(--t-border)",
        // Keyboard closed: the shell spans edge-to-edge, so inset the row above the Android
        // system nav bar. Keyboard open: stay flush above the keyboard (no inset; the nav bar
        // is behind the keyboard).
        paddingBottom: keyboardOpen ? 0 : "env(safe-area-inset-bottom)",
      }}
      onMouseDown={noFocusSteal} onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}>
      <div ref={modsRef} data-mobile-modifiers className="flex shrink-0 items-center gap-[6px]">
      {MODS.map(({ mod, label }) => {
        const v = latch[mod];
        return (
          <button key={mod} data-mobile-key={mod} aria-pressed={isActive(v)} aria-label={label}
            onMouseDown={(e) => { noFocusSteal(e); }}
            onTouchStart={(e) => {
              noFocusSteal(e);
              clearPressTimer(longPressTimer);
              // On fire, null the ref so touchend treats this as a completed lock (not a tap).
              longPressTimer.current = setTimeout(() => { longPressTimer.current = null; lockMod(mod); }, 450);
            }}
            onTouchEnd={(e) => {
              noFocusSteal(e);
              // Timer still pending = short tap → arm/toggle. If the lock already fired it
              // nulled the ref, so we skip tapMod and keep the lock.
              if (longPressTimer.current) { clearPressTimer(longPressTimer); tapMod(mod); }
            }}
            // Row is horizontally scrollable: a scroll cancels the touch with no touchend,
            // so clear the pending lock timer to avoid a stray lock firing mid-scroll.
            onTouchMove={() => clearPressTimer(longPressTimer)}
            onTouchCancel={() => clearPressTimer(longPressTimer)}
            onClick={(e) => { noFocusSteal(e); if (isActivationClick(e)) tapMod(mod); }}
            className={`${keyClass} font-semibold`}
            data-latch={v}
            style={keyFace(v === "locked" ? "var(--t-bg-elevated)" : v === "armed" ? "color-mix(in srgb, var(--t-accent) 20%, var(--t-bg-card))" : "var(--t-bg-card)", isActive(v) ? "var(--t-text-bright)" : "var(--t-text-primary)")}>
            {label}{v === "locked" && <Icon icon="lucide:lock-keyhole" width={10} aria-hidden="true" />}
          </button>
        );
      })}
      </div>
      <div className={pinned ? "mobile-key-scroll-wrap" : "shrink-0"} data-at-end={atEnd}>
      <div data-mobile-key-scroll={pinned || undefined}
        className="mobile-terminal-chrome-scroll flex items-center gap-[6px]"
        style={{ overflowX: pinned ? "auto" : "visible" }}
        onScroll={(e) => { const el = e.currentTarget; setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1); }}>
      {KEYS.map(({ key, label, icon }) => (
        <button key={key} data-mobile-key={key} aria-label={label ?? key}
          // Touch path: fire once on touchend (a tap), never on touchstart — so the row
          // can be scrolled by dragging a button without firing its key, and the ghost
          // mousedown/click is suppressed on touch (mirrors the MODS' onClick guard).
          onMouseDown={noFocusSteal}
          onTouchStart={(e) => {
            noFocusSteal(e);
            const t = e.touches[0];
            keyTouchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            noFocusSteal(e);
            const start = keyTouchStart.current;
            keyTouchStart.current = null;
            const t = e.changedTouches[0];
            if (!start || !t) return;
            if (Math.hypot(t.clientX - start.x, t.clientY - start.y) < TAP_MOVE_PX) press(key);
          }}
          onTouchCancel={() => { keyTouchStart.current = null; }}
          onClick={(e) => { noFocusSteal(e); if (isActivationClick(e)) press(key); }}
          className={`${keyClass} font-medium`}
          style={keyFace("var(--t-bg-card)")}>
          {icon ? <Icon icon={icon} width={16} /> : label}
        </button>
      ))}
      <button data-mobile-panels-toggle aria-label={t("mobile.terminalTopBar.panelsAriaLabel")} aria-pressed={panelsOpen}
        onMouseDown={noFocusSteal}
        onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}
        onClick={(e) => { noFocusSteal(e); togglePanels(!!keyboardOpen); }}
        className={`${keyClass} font-medium`}
        style={keyFace(panelsOpen ? "var(--t-bg-elevated)" : "var(--t-bg-card)", panelsOpen ? "var(--t-text-bright)" : "var(--t-text-primary)")}>
        <Icon icon="lucide:layout-grid" width={16} />
      </button>
      </div>
      </div>
    </div>
  );
}
