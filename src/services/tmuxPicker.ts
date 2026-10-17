import type { Connection } from "@/types";
import { resolveConnectionCredentials } from "./credentials";
import { sshConnect, sshDisconnect, sshSessionCancel, type SessionChoice, type SessionListing, type RemoteSession, type SessionBackend } from "./ssh";
import { buildSshConnectOptions, useSessionStore } from "@/stores/sessionStore";
import { findSessionTab, sessionAttachChoice, tmuxEndpoint, modeForSession } from "./tmuxSessionCore";

/** A picker owns only its temporary SSH connection and any new tab it is still opening. */
export function createSessionPicker(connection: Connection, backend: SessionBackend | null, preparedId: string = crypto.randomUUID()) {
  let closed = false;
  let started = false;
  let transferred = false;
  let opening: Promise<string> | null = null;
  let newSessionId: string | null = null;
  let username = connection.username;

  const ready: Promise<SessionListing | null> = (async () => {
    if (!backend) return null;
    const credentials = await resolveConnectionCredentials(connection);
    username = credentials.username;
    const options = await buildSshConnectOptions(connection, preparedId);
    if (closed) throw new Error("SESSION_PICKER_CLOSED");
    started = true;
    const result = await sshConnect({
      ...options, ...credentials, username, sessionId: preparedId,
      host: connection.host, port: connection.port, connectionId: connection.id,
      prepareBackend: backend, autoForward: false,
    });
    if (!result.session_listing || result.session_listing.backend !== backend) throw new Error("SESSION_INVALID_LIST_RESPONSE");
    return result.session_listing;
  })();

  const release = () => started ? sshSessionCancel(preparedId).catch(() => {}) : Promise.resolve();
  // Cancellation can happen during authentication; release again AFTER it settles, so a late
  // prepare cannot resurrect a connection. The backend also expires abandoned pickers in 5 min.
  const settled = ready.then(() => { if (closed) return release(); }, () => release());

  function close() {
    closed = true;
    if (!transferred) {
      void release();
      void settled;
    }
  }

  function open(choice?: SessionChoice, selected?: RemoteSession): Promise<string> {
    if (choice && (choice.backend !== backend || (selected && selected.backend !== backend))) return Promise.reject(new Error("SESSION_BACKEND_CHANGED"));
    if (closed) return Promise.reject(new Error("SESSION_PICKER_CLOSED"));
    if (opening) return opening; // A rapid double tap shares one operation.
    opening = (async () => {
      let prepared = backend !== null;
      try { await ready; } catch (error) { if (choice) throw error; prepared = false; }
      if (closed) throw new Error("SESSION_PICKER_CLOSED");
      if (selected) {
        const existing = findSessionTab(useSessionStore.getState().sessions, connection.id, username, selected, tmuxEndpoint(connection));
        if (existing) {
          await release();
          if (closed) throw new Error("SESSION_PICKER_CLOSED");
          // Refresh the displayed name, but identity is the stable remote tuple, never its label.
          useSessionStore.setState((s) => ({ sessions: s.sessions.map((tab) => tab.id === existing.id
            ? { ...tab, sshMode: modeForSession(selected, username, tmuxEndpoint(connection)) } : tab) }));
          useSessionStore.getState().setActive(existing.id);
          // An offline tab is reused. Its existing error/reconnect UI stays available.
          transferred = true;
          return existing.id;
        }
      }
      newSessionId = crypto.randomUUID();
      const id = newSessionId;
      try {
        await useSessionStore.getState().connect(connection.id, {
          sessionId: id, background: true, keepFailedSession: !choice,
          sshLaunch: { preparedId: prepared ? preparedId : undefined, choice, session: selected, username },
        });
        if (closed) throw new Error("SESSION_PICKER_CLOSED");
        transferred = true;
        useSessionStore.getState().setActive(id);
        return id;
      } finally {
        await release();
        if (!transferred) {
          // This tab is being abandoned, not reconnected: release its forwarding reference too.
          // The backend hands shared host forwards to surviving tabs; never kill the tmux session.
          await sshDisconnect(id, undefined, false, false).catch(() => {});
          useSessionStore.getState().removeSession(id);
        }
      }
    })();
    return opening;
  }

  return { ready, close, open, attach: (session: RemoteSession) => open(sessionAttachChoice(session), session) };
}

export type SessionPicker = ReturnType<typeof createSessionPicker>;

/** Compatibility entry point for the already-validated tmux path. */
export function createTmuxPicker(connection: Connection, preparedId?: string) {
  return createSessionPicker(connection, "tmux", preparedId);
}
