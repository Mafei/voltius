import type { SessionBackend } from "./ssh";

export const sessionBackendLabel: Record<SessionBackend, string> = { tmux: "Tmux", zellij: "Zellij", tuios: "TUIOS" };

export function isSessionBackend(value: unknown): value is SessionBackend {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(sessionBackendLabel, value);
}

export function validTuiosName(name: string): boolean {
  return !!name && name.trim() === name && new TextEncoder().encode(name).length <= 128
    && !name.startsWith("-") && !name.endsWith(".") && !/^[.]+$/.test(name)
    && !/[\p{Cc}/\\]/u.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}
