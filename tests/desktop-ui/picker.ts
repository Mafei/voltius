import type { Connection } from "@/types";
import type { SessionBackend, SessionChoice, RemoteSession } from "@/services/ssh";
export const metrics = { opens: 0, closes: 0 };
export function createSessionPicker(_host: Connection, backend: SessionBackend | null) {
  let closed = false;
  const sessions: RemoteSession[] = backend ? ["New", "中文工作"].map((name, index) => backend === "tmux"
    ? { backend, session: { name, id: `$${index}`, windows: 1, attached: 0, created: 123, server_pid: 42 } }
    : { backend, session: { name, socket_dir: "/tmp/synthetic/contract_version_1", socket_id: `10:${20 + index}` } }) : [];
  const open = async (choice?: SessionChoice, remote?: RemoteSession) => {
    if (closed) throw new Error("SESSION_PICKER_CLOSED");
    metrics.opens++;
    return remote ? `${remote.backend}:${remote.session.name}` : choice?.choice.kind === "create" ? `${choice.backend}:new:${choice.choice.name}` : "plain";
  };
  return {
    ready: Promise.resolve(backend ? { backend, installed: true, version: backend === "tmux" ? "tmux 3.4" : "zellij 0.45.1", sessions, reserved_names: sessions.map((s) => s.session.name) } : null),
    close: () => { closed = true; metrics.closes++; }, open,
    attach: (remote: RemoteSession) => open(undefined, remote),
  };
}
export type SessionPicker = ReturnType<typeof createSessionPicker>;
