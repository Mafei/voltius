import type { Connection } from "@/types";
import { resolveConnectionCredentials } from "./credentials";
import { sshConnect, sshDisconnect, sshSessionCancel, type SessionChoice, type SessionListing, type RemoteSession, type SessionBackend } from "./ssh";
import { buildSshConnectOptions, useSessionStore } from "@/stores/sessionStore";
import { findSessionTab, sessionAttachChoice, tmuxEndpoint, modeForSession } from "./tmuxSessionCore";
import { activateOwnedSession } from "./tabActivation";
import { isMobileShell } from "@/utils/platform";
import { withSystemPassphrases } from "./systemSshAuth";

/** A picker owns only its temporary SSH connection and any new tab it is still opening. */
export function createSessionPicker(connection: Connection, backend: SessionBackend | null, preparedId: string = crypto.randomUUID(), pickerOptions: { direct?: boolean; auth?: { password?: string; passphrase?: string; systemPassphrases?: Record<string, string> } } = {}) {
  let closed = false;
  let started = false;
  let transferred = false;
  let opening: Promise<string> | null = null;
  let newSessionId: string | null = null;
  let username = connection.username;

  const ready: Promise<SessionListing | null> = (async () => {
    if (!backend) return null;
    const credentials = { ...await resolveConnectionCredentials(connection), ...pickerOptions.auth };
    username = credentials.username;
    const options = await buildSshConnectOptions(connection, preparedId);
    if (closed) throw new Error("SESSION_PICKER_CLOSED");
    started = true;
    const result = await sshConnect(withSystemPassphrases({
      ...options, ...credentials, username, sessionId: preparedId,
      host: connection.host, port: connection.port, connectionId: connection.id,
      prepareBackend: backend, autoForward: false,
    }, pickerOptions.auth?.systemPassphrases ?? {}));
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
        const restoring = choice?.backend === "tuios" && choice.choice.kind === "restore";
        const existing = findSessionTab(useSessionStore.getState().sessions, connection.id, username, selected, tmuxEndpoint(connection), restoring);
        if (existing) {
          if (choice?.backend === "tuios" && choice.choice.kind === "restore") {
            if (existing.status === "connecting" || existing.status === "connected") throw new Error("SESSION_CHANGED");
            await useSessionStore.getState().reconnect(existing.id, {
              sshLaunch: { preparedId, choice: { ...choice, choice: { ...choice.choice,
                expected: existing.sshMode?.kind === "tuios" && existing.sshMode.session.id
                  ? { id: existing.sshMode.session.id } : undefined,
              } }, session: selected, username },
            });
            await release();
            if (useSessionStore.getState().sessions.find(s => s.id === existing.id)?.status !== "connected") throw new Error("TUIOS_RESTORE_FAILED");
          } else await release();
          if (closed) throw new Error("SESSION_PICKER_CLOSED");
          // Refresh the displayed name, but identity is the stable remote tuple, never its label.
          const restoredMode = restoring ? useSessionStore.getState().sessions.find(s => s.id === existing.id)?.sshMode : undefined;
          if (restoring && (restoredMode?.kind !== "tuios" || !restoredMode.session.id || restoredMode.session.saved)) throw new Error("TUIOS_RESTORE_FAILED");
          const mode = restoredMode ?? modeForSession(selected, username, tmuxEndpoint(connection));
          useSessionStore.setState((s) => ({ sessions: s.sessions.map((tab) => tab.id === existing.id
            ? { ...tab, sshMode: mode } : tab) }));
          if (isMobileShell()) useSessionStore.getState().setActive(existing.id);
          else activateOwnedSession(existing.id);
          // An offline tab is reused. Its existing error/reconnect UI stays available.
          transferred = true;
          return existing.id;
        }
      }
      newSessionId = crypto.randomUUID();
      const id = newSessionId;
      try {
        const launch = {
          sessionId: id, background: true, keepFailedSession: !choice,
          sshLaunch: { preparedId: prepared ? preparedId : undefined, choice, session: selected, username },
        };
        if (pickerOptions.direct) await useSessionStore.getState().connectDirect(connection, launch);
        else await useSessionStore.getState().connect(connection.id, launch);
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

  return { ready, close, open, attach: (session: RemoteSession) => open(sessionAttachChoice(session), session),
    restore: (session: Extract<RemoteSession, { backend: "tuios" }>) => {
      if (!session.session.saved) return Promise.reject(new Error("SESSION_CHANGED"));
      return open({ backend: "tuios", choice: { kind: "restore", session: session.session } }, session);
    } };
}

export type SessionPicker = ReturnType<typeof createSessionPicker>;

/** Compatibility entry point for the already-validated tmux path. */
export function createTmuxPicker(connection: Connection, preparedId?: string) {
  return createSessionPicker(connection, "tmux", preparedId);
}
