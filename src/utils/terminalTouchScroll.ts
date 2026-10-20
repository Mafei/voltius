import { linesFromPixelDelta } from "@/components/mobile/mobileTerminalGesturesCore";
import type { Terminal } from "@xterm/xterm";
import { scrollTerminalPixels, resetTerminalPixels } from "./terminalPixelScroll";

const remainders = new WeakMap<Terminal, number>();

/** Enter xterm's existing wheel path: shell scrollback, alternate-screen arrows,
 * and mouse reporting all retain their usual ownership and input gates. */
export function scrollTerminalByTouch(term: Terminal, deltaY: number, x: number, y: number): void {
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) return;
  if (term.buffer.active.type === "normal" && term.modes.mouseTrackingMode === "none") {
    remainders.delete(term);
    scrollTerminalPixels(term, deltaY);
    return;
  }
  // Remote mouse/alternate-screen protocols expose whole wheel ticks/arrows,
  // not a pixel viewport. Preserve sub-line movement without claiming 1:1.
  resetTerminalPixels(term);
  const step = linesFromPixelDelta(deltaY, screen.clientHeight / term.rows, remainders.get(term) ?? 0);
  remainders.set(term, step.carry);
  if (!step.lines) return;
  screen.dispatchEvent(new WheelEvent("wheel", { deltaY: step.lines, deltaMode: WheelEvent.DOM_DELTA_LINE,
    clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

export const endTerminalTouchScroll = (term: Terminal) => { remainders.delete(term); };
