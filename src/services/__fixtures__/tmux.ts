import type { TerminalSession } from "@/types";
import type { TmuxSession } from "../ssh";

export const tmuxSession = (overrides: Partial<TmuxSession> = {}): TmuxSession => ({
  id: "$0", name: "工作 ' $shell; 🐚", windows: 2, attached: 1, created: 123, server_pid: 42, ...overrides,
});

export const tmuxTab = (overrides: Partial<TerminalSession> = {}): TerminalSession => ({
  id: "tab-1", connectionId: "host-a", connectionName: "服务器 A", status: "connected", type: "ssh",
  sshMode: { kind: "tmux", session: tmuxSession(), username: "alice", endpoint: "example.test:22" }, persist: false, ...overrides,
});
