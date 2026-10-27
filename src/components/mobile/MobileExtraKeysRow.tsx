import { haptic } from "@/lib/haptics";
import { EXTRA_KEYS, keyForGesture, keyGesture, modTapAction, type ExtraKey } from "./extraKeysCore";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { isActive, type Modifier } from "@/stores/modifierLatchCore";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { sendSpecialKey } from "@/services/terminalInput";
import type { SpecialKey } from "@/services/terminalKeyCore";
import { useUIStore } from "@/stores/uiStore";
import { useTranslation } from "react-i18next";
import "./terminalChrome.css";
import { terminalChromeFaceStyle as keyFace } from "./terminalChrome";
import { terminalPanelsVisible } from "./terminalChromeState";
import { terminalClipboardAction } from "@/hooks/useTerminal";
import { useMobilePasteConfirmStore } from "@/stores/mobilePasteConfirmStore";

type KeyDef = Omit<ExtraKey, "key"> & { key: SpecialKey | "Paste" };
const MOD_LOCK_HOLD_MS = 450;
const KEYS: KeyDef[] = [
  ...["Esc", "Tab", "Up", "Down", "Left", "Right"].map(key => EXTRA_KEYS.find(k => k.key === key)!),
  { key: "Home", label: "Home" }, { key: "End", label: "End" }, { key: "PgUp", label: "PgUp" }, { key: "PgDn", label: "PgDn" },
  { key: "+", label: "+" }, { key: "|", label: "|" }, { key: "Paste" },
  ...EXTRA_KEYS.filter(k => k.key === "-" || k.key === "/"),
];
const MODS: { mod: Modifier; label: string }[] = [ { mod: "ctrl", label: "Ctrl" }, { mod: "alt", label: "Alt" } ];
const keyClass = "mobile-chrome-face mobile-terminal-toolbar-button";
function clearPressTimer(timer: { current: ReturnType<typeof setTimeout> | null }) {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
}
// Touchend already handles taps; detail=0 preserves keyboard/assistive activation.
const isActivationClick = (event: React.MouseEvent) => !("ontouchstart" in window) || event.detail === 0;

export default function MobileExtraKeysRow({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const pendingPaste = useMobilePasteConfirmStore(s => s.pending);
  const finishPaste = useMobilePasteConfirmStore(s => s.finish);
  useEffect(() => {
    if (pendingPaste && pendingPaste.sessionId !== activeSessionId) finishPaste(false);
  }, [pendingPaste, activeSessionId, finishPaste]);
  useEffect(() => () => { useMobilePasteConfirmStore.getState().finish(false); }, []);
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
  const lastModTap = useRef<Record<Modifier, number | null>>({ ctrl: null, alt: null });
  const keyTouchStart = useRef<{ x: number; y: number } | null>(null);
  // The key whose alternate a swipe up would send right now (its superscript lights up).
  const [altArmed, setAltArmed] = useState<SpecialKey | null>(null);

  const press = (key: KeyDef["key"]) => {
    const activeSessionId = useSessionStore.getState().activeSessionId;
    if (!activeSessionId) return;
    if (key === "Paste") { void terminalClipboardAction(activeSessionId, "pasteClipboard").catch(() => {}); return; }
    haptic("key");
    sendSpecialKey(activeSessionId, key, { ctrl: isActive(latch.ctrl), alt: isActive(latch.alt) });
    consume();
  };
  const lockMod = (mod: Modifier) => { haptic("press"); lock(mod); };
  const tapMod = (mod: Modifier) => {
    const now = performance.now();
    if (modTapAction(latch[mod], lastModTap.current[mod], now) === "lock") {
      lastModTap.current[mod] = null;
      lockMod(mod);
      return;
    }
    lastModTap.current[mod] = now;
    haptic("key");
    tap(mod);
  };
  const noFocusSteal = (e: React.SyntheticEvent) => e.preventDefault();
  // The row must never summon the soft keyboard. The xterm textarea is programmatically focused
  // (Android keeps the IME hidden), so the first touch gesture would otherwise pop the IME for it.
  // When the keyboard is closed, blur the focused element on touch so the tap can't trigger it.
  // Keyboard open: leave focus alone so it stays open for continued typing.
  const keepKeyboardClosed = () => { if (!keyboardOpen) (document.activeElement as HTMLElement | null)?.blur(); };
  const travel = (e: React.TouchEvent) => {
    const start = keyTouchStart.current;
    const t = e.changedTouches[0] ?? e.touches[0];
    return start && t ? { dx: t.clientX - start.x, dy: t.clientY - start.y } : null;
  };


  return (
    // Keep system navigation inset outside both identically measured toolbars.
    <div className="relative shrink-0 min-w-0" style={{ paddingBottom: keyboardOpen ? 0 : "env(safe-area-inset-bottom)", background: "var(--t-bg-chrome)" }}>
    {pendingPaste && pendingPaste.sessionId === activeSessionId && (
      <div role="alertdialog" aria-label={t("common.action.paste")} className="absolute bottom-full inset-x-0 z-50 p-3 rounded-lg bg-(--t-bg-modal) border border-(--t-border) text-(--t-text-primary)"
        onMouseDown={noFocusSteal} onTouchStart={noFocusSteal}>
        <p className="text-sm">{t("terminal.paste.multilineConfirm", { defaultValue: "Paste text containing line breaks? The remote application may execute commands. No extra Enter is added." })}</p>
        <div className="flex gap-2 justify-end mt-2">
          {[false, true].map(accept => <button key={String(accept)} className={`btn ${accept ? "btn-primary" : "btn-secondary"}`}
            onTouchEnd={e => { noFocusSteal(e); finishPaste(accept); }}
            onClick={e => { noFocusSteal(e); if (isActivationClick(e)) finishPaste(accept); }}>
            {t(accept ? "common.action.paste" : "common.action.cancel")}
          </button>)}
        </div>
      </div>
    )}
    <div ref={rootRef} data-mobile-extra-keys data-modifiers-pinned={pinned} data-mobile-key-scroll={!pinned || undefined}
      className="mobile-terminal-chrome mobile-terminal-toolbar mobile-terminal-chrome-scroll"
      style={{ overflowX: pinned ? "visible" : "auto" }}
      onMouseDown={noFocusSteal} onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}>
      <div ref={modsRef} data-mobile-modifiers className="mobile-terminal-toolbar-strip shrink-0">
      {MODS.map(({ mod, label }) => {
        const v = latch[mod];
        return (
          <button key={mod} data-mobile-key={mod} aria-pressed={isActive(v)} aria-label={label}
            onMouseDown={(e) => { noFocusSteal(e); }}
            onTouchStart={(e) => {
              noFocusSteal(e);
              clearPressTimer(longPressTimer);
              // On fire, null the ref so touchend treats this as a completed lock (not a tap).
              longPressTimer.current = setTimeout(() => { longPressTimer.current = null; lockMod(mod); }, MOD_LOCK_HOLD_MS);
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
        className="mobile-terminal-chrome-scroll mobile-terminal-toolbar-strip"
        style={{ overflowX: pinned ? "auto" : "visible" }}
        onScroll={(e) => { const el = e.currentTarget; setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1); }}>
      {KEYS.map((k) => { const { key, label, icon } = k; return (
        <button key={key} data-mobile-key={key} data-mobile-key-alt={k.alt} data-alt-armed={altArmed === key ? "" : undefined} aria-label={key === "Paste" ? t("common.action.paste") : label ?? key} title={key === "Paste" ? "Ctrl+Shift+V" : undefined}
          // Touch path: fire once on touchend (a tap), never on touchstart — so the row
          // can be scrolled by dragging a button without firing its key, and the ghost
          // mousedown/click is suppressed on touch (mirrors the MODS' onClick guard).
          onMouseDown={noFocusSteal}
          onTouchStart={(e) => {
            noFocusSteal(e);
            const t = e.touches[0];
            keyTouchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchMove={(e) => {
            const d = travel(e);
            setAltArmed(d && k.alt && keyGesture(d.dx, d.dy) === "alt" && key !== "Paste" ? key : null);
          }}
          onTouchEnd={(e) => {
            noFocusSteal(e);
            setAltArmed(null);
            const start = keyTouchStart.current;
            keyTouchStart.current = null;
            const t = e.changedTouches[0];
            if (!start || !t) return;
            const gesture = keyGesture(t.clientX - start.x, t.clientY - start.y);
            const selected = key === "Paste" ? (gesture === "tap" ? key : null) : keyForGesture({ ...k, key }, gesture);
            if (selected) press(selected);
          }}
          onTouchCancel={() => { keyTouchStart.current = null; setAltArmed(null); }}
          onClick={(e) => { noFocusSteal(e); if (isActivationClick(e)) press(key); }}
          className={`${keyClass} relative font-medium`}
          style={keyFace("var(--t-bg-card)")}>
          {icon ? <Icon icon={icon} width={16} /> : key === "Paste" ? t("common.action.paste") : label}
          {k.altLabel && <sup data-mobile-key-alt-label aria-hidden className="absolute top-0.5 right-1 text-[9px]" style={{ color: altArmed === key ? "var(--t-accent)" : "var(--t-text-dim)" }}>{k.altLabel}</sup>}
        </button>
      ); })}
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
    </div>
  );
}
