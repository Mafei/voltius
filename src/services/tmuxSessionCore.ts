import { isSessionBackend } from "./sessionTypes";
import type { RemoteSession, SessionChoice, SshMode, TmuxChoice, TmuxSession } from "./ssh";
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
  return findSessionTab(sessions, connectionId, username, { backend: "tmux", session: target }, endpoint);
}

export function isUserSession(mode: SshMode | undefined): mode is Exclude<SshMode, { kind: "plain" }> {
  return !!mode && isSessionBackend(mode.kind);
}

export function remoteFromMode(mode: Exclude<SshMode, { kind: "plain" }>): RemoteSession {
  return { backend: mode.kind, session: mode.session } as RemoteSession;
}

export function modeForSession(remote: RemoteSession, username: string, endpoint: string): SshMode {
  return { kind: remote.backend, session: remote.session, username, endpoint } as SshMode;
}

export function sessionAttachChoice(remote: RemoteSession): SessionChoice {
  return remote.backend === "tmux" ? { backend: "tmux", choice: tmuxAttachChoice(remote.session) }
    : { backend: remote.backend, choice: { kind: "attach", session: remote.session } } as SessionChoice;
}

export function sameRemoteSession(a: RemoteSession, b: RemoteSession): boolean {
  if (a.backend === "tmux" && b.backend === "tmux") return sameTmux(a.session, b.session);
  if (a.backend === "zellij" && b.backend === "zellij") return a.session.socket_dir === b.session.socket_dir && a.session.socket_id === b.session.socket_id;
  if (a.backend === "tuios" && b.backend === "tuios") return a.session.id === b.session.id && a.session.created === b.session.created;
  return false;
}

export function findSessionTab(sessions: TerminalSession[], connectionId: string, username: string, target: RemoteSession, endpoint: string): TerminalSession | undefined {
  return sessions.find((s) => s.type === "ssh" && s.connectionId === connectionId &&
    isUserSession(s.sshMode) && s.sshMode.username === username && s.sshMode.endpoint === endpoint && sameRemoteSession(remoteFromMode(s.sshMode), target));
}
