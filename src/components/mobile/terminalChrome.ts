import type { CSSProperties } from "react";
export const terminalChromeFaceStyle = (background = "var(--t-bg-card)", color = "var(--t-text-primary)"): CSSProperties =>
  ({ "--mobile-face-bg": background, color }) as CSSProperties;
