import { useSessionStore } from "@/stores/sessionStore";
import { goToTerminal } from "@/services/terminalNavigation";
import { buildQuickConnectConnection, type QuickConnectIntent } from "@/services/quickConnect";
import { findAnyConnection } from "@/stores/connectionStore";
import { useSessionConnectionStore } from "@/stores/sessionConnectionStore";
import { isMobileShell } from "@/utils/platform";
import type { Connection } from "@/types";
export { goToTerminal } from "@/services/terminalNavigation";

export function isSessionConnection(connection: Connection): boolean {
  return (connection.connection_type ?? "ssh") === "ssh";
}

export function chooseHostSessions(connections: Connection[], complete: (ids: string[]) => void = () => goToTerminal(), direct = false): void {
  useSessionConnectionStore.getState().request(connections, complete, direct);
}

export function launchConnection(connection: Connection): void { launchHost(connection.id); }

/** Connect to a saved host by id, then switch to the terminal view. */
export function launchHost(connectionId: string): void {
  const connection = findAnyConnection(connectionId);
  if (!isMobileShell() && connection && isSessionConnection(connection)) {
    chooseHostSessions([connection]);
    return;
  }
  useSessionStore.getState().connect(connectionId).catch(() => {});
  goToTerminal();
}

/** Launch an SSH/serial/local quick-connect intent, then switch to the terminal view. */
export function launchQuickConnect(intent: Exclude<QuickConnectIntent, null>): void {
  const s = useSessionStore.getState();
  if (intent.kind === "ssh") {
    const connection = buildQuickConnectConnection(intent, !isMobileShell());
    if (!isMobileShell()) { chooseHostSessions([connection], () => goToTerminal(), true); return; }
    s.connectDirect(connection).catch(() => {});
  } else if (intent.kind === "serial") {
    s.connectSerialEphemeral(intent.port).catch(() => {});
  } else {
    if (intent.shell) s.beginLocalSession(intent.shell);
    else s.connectLocal().catch(() => {});
  }
  goToTerminal();
}

/** Open a plain local shell, then switch to the terminal view. */
export function launchLocal(): void {
  useSessionStore.getState().connectLocal().catch(() => {});
  goToTerminal();
}

/**
 * Open a local terminal for a specific shell path (e.g. /bin/zsh). Falls back
 * to the preferred/default shell when no path is given.
 */
export function launchLocalShell(shellPath?: string): void {
  const s = useSessionStore.getState();
  if (shellPath) s.beginLocalSession(shellPath);
  else s.connectLocal().catch(() => {});
  goToTerminal();
}
