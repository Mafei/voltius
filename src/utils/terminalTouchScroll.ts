import { linesFromPixelDelta } from "@/components/mobile/mobileTerminalGesturesCore";
import type { Terminal } from "@xterm/xterm";

const remainders = new WeakMap<Terminal, number>();

/** Enter xterm's existing wheel path: shell scrollback, alternate-screen arrows,
 * and mouse reporting all retain their usual ownership and input gates. */
export function scrollTerminalByTouch(term: Terminal, deltaY: number, x: number, y: number): void {
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) return;
  if (term.buffer.active.type === "normal" && term.modes.mouseTrackingMode === "none") {
    const step = linesFromPixelDelta(deltaY, screen.clientHeight / term.rows, remainders.get(term) ?? 0);
    remainders.set(term, step.carry);
    if (step.lines) term.scrollLines(step.lines);
    return;
  }
  remainders.delete(term);
  screen.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    clientX: x, clientY: y, bubbles: true, cancelable: true }));
}
