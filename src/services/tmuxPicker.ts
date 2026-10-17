import type { Connection } from "@/types";
import { resolveConnectionCredentials } from "./credentials";
import { sshConnect, sshDisconnect, sshTmuxCancel, type TmuxChoice, type TmuxListing, type TmuxSession } from "./ssh";
import { buildSshConnectOptions, useSessionStore } from "@/stores/sessionStore";
import { findTmuxTab, tmuxAttachChoice, tmuxEndpoint } from "./tmuxSessionCore";

/** A picker owns only its temporary SSH connection and any new tab it is still opening. */
export function createTmuxPicker(connection: Connection, preparedId = crypto.randomUUID()) {
  let closed = false;
  let started = false;
  let transferred = false;
  let opening: Promise<string> | null = null;
  let newSessionId: string | null = null;
  let username = connection.username;

  const ready: Promise<TmuxListing> = (async () => {
    const credentials = await resolveConnectionCredentials(connection);
    username = credentials.username;
    const options = await buildSshConnectOptions(connection, preparedId);
    if (closed) throw new Error("TMUX_PICKER_CLOSED");
    started = true;
    const result = await sshConnect({
      ...options, ...credentials, username, sessionId: preparedId,
      host: connection.host, port: connection.port, connectionId: connection.id,
      prepareTmux: true, autoForward: false,
    });
    if (!result.tmux_listing) throw new Error("TMUX_INVALID_LIST_RESPONSE");
    return result.tmux_listing;
  })();

  const release = () => started ? sshTmuxCancel(preparedId).catch(() => {}) : Promise.resolve();
  // Cancellation can happen during authentication; release again AFTER it settles, so a late
  // prepare cannot resurrect a connection. The backend also expires abandoned pickers in 5 min.
  const settled = ready.then(() => { if (closed) return release(); }, () => { if (closed) return release(); });

  function close() {
    closed = true;
    if (!transferred) {
      void release();
      void settled;
    }
  }

  function open(choice?: TmuxChoice, selected?: TmuxSession): Promise<string> {
    if (closed) return Promise.reject(new Error("TMUX_PICKER_CLOSED"));
    if (opening) return opening; // A rapid double tap shares one operation.
    opening = (async () => {
      let prepared = true;
      try { await ready; } catch (error) { if (choice) throw error; prepared = false; }
      if (closed) throw new Error("TMUX_PICKER_CLOSED");
      if (selected) {
        const existing = findTmuxTab(useSessionStore.getState().sessions, connection.id, username, selected, tmuxEndpoint(connection));
        if (existing) {
          await release();
          // Refresh the displayed name, but identity is the stable remote tuple, never its label.
          useSessionStore.setState((s) => ({ sessions: s.sessions.map((tab) => tab.id === existing.id
            ? { ...tab, sshMode: { kind: "tmux" as const, session: selected, username, endpoint: tmuxEndpoint(connection) } } : tab) }));
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
        if (closed) throw new Error("TMUX_PICKER_CLOSED");
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

  return { ready, close, open, attach: (session: TmuxSession) => open(tmuxAttachChoice(session), session) };
}

export type TmuxPicker = ReturnType<typeof createTmuxPicker>;
