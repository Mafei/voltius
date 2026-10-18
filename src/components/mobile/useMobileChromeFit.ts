import { useEffect, useRef } from "react";

/** Preserve touch targets and some terminal space in a very short IME viewport.
 * Only the redundant visual subtitle yields; its full accessible title stays.
 * Natural two-line height is measured even while hidden, preventing oscillation. */
export function useMobileChromeFit() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = ref.current, parent = header?.parentElement;
    if (!header || !parent) return;
    let frame: number | null = null;
    const number = (value: string) => parseFloat(value) || 0;
    const update = () => {
      frame = null;
      const viewport = window.visualViewport;
      const available = (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0) - header.getBoundingClientRect().top;
      const naturalHeight = Math.max(number(getComputedStyle(header).getPropertyValue("--mobile-touch-size")), ...[...header.querySelectorAll<HTMLElement>("[data-mobile-session-label]")].map((label) => {
        const style = getComputedStyle(label);
        return number(style.paddingTop) + number(style.paddingBottom) + [...label.children].reduce((height, line) => height + number(getComputedStyle(line).lineHeight), 0);
      }));
      const panels = parent.querySelector<HTMLElement>("[data-mobile-panels-row]");
      const keys = parent.querySelector<HTMLElement>("[data-mobile-extra-keys]");
      // The key footer also owns the system navigation safe-area inset.
      const footerHeight = (panels?.getBoundingClientRect().height ?? 0) + (keys?.parentElement?.getBoundingClientRect().height ?? 0);
      const compact = String(naturalHeight + footerHeight + number(getComputedStyle(header).getPropertyValue("--mobile-terminal-reserve")) > available);
      if (header.dataset.mobileCompactContext !== compact) header.dataset.mobileCompactContext = compact;
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const observe = () => {
      resize?.observe(header);
      for (const selector of ["[data-mobile-panels-row]", "[data-mobile-extra-keys]"]) {
        const node = parent.querySelector<HTMLElement>(selector);
        if (node) resize?.observe(node);
      }
      schedule();
    };
    const children = new MutationObserver(observe);
    children.observe(parent, { childList: true });
    observe();
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      resize?.disconnect(); children.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      delete header.dataset.mobileCompactContext;
    };
  }, []);
  return ref;
}
