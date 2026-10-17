import type { TmuxChoice, TmuxSession } from "./ssh";
import type { Connection, TerminalSession } from "@/types";

export function tmuxAttachChoice(s: TmuxSession): TmuxChoice {
  return { kind: "attach", id: s.id, created: s.created, serverPid: s.server_pid };
}

/** Server PID + creation time prevent a recycled $id after a tmux server restart matching a tab. */
export function sameTmux(a: TmuxSession, b: TmuxSession): boolean {
  return a.id === b.id && a.created === b.created && a.server_pid === b.server_pid;
}

export function tmuxEndpoint(connection: Pick<Connection, "host" | "port">): string {
  return `${connection.host.includes(":") ? `[${connection.host}]` : connection.host}:${connection.port}`;
}

export function findTmuxTab(sessions: TerminalSession[], connectionId: string, username: string, target: TmuxSession, endpoint: string): TerminalSession | undefined {
  return sessions.find((s) => s.type === "ssh" && s.connectionId === connectionId &&
    s.sshMode?.kind === "tmux" && s.sshMode.username === username && s.sshMode.endpoint === endpoint && sameTmux(s.sshMode.session, target));
}
