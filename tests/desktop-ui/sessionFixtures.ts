import type { TerminalSession } from "@/types";

/** Shared synthetic multiplexer identity; never a real connection or credential. */
export function muxSessionFixture(id: string, name: string, backend: "tmux" | "zellij", customTitle?: string): TerminalSession {
  const target = { username: "alice", endpoint: "synthetic.example.invalid:22" };
  return {
    id, connectionId: "synthetic-ui-layout", connectionName: "合成主机 / Synthetic host", type: "ssh", status: "connected", customTitle,
    sshMode: backend === "tmux"
      ? { kind: backend, ...target, session: { id: "$1", name, windows: 1, attached: 0, created: 1, server_pid: 1 } }
      : { kind: backend, ...target, session: { name, socket_dir: "/synthetic", socket_id: "1:2" } },
  };
}
