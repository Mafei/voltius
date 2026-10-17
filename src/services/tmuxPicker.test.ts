import { beforeEach, expect, test, vi } from "vitest";
import type { Connection, TerminalSession } from "@/types";
import { tmuxSession, tmuxTab } from "./__fixtures__/tmux";

const h = vi.hoisted(() => ({
  prepare: vi.fn(), cancel: vi.fn(async () => {}), drop: vi.fn(async () => {}),
  credentials: vi.fn(), connect: vi.fn(), active: vi.fn(), remove: vi.fn(),
  sessions: [] as TerminalSession[],
}));
vi.mock("./credentials", () => ({ resolveConnectionCredentials: h.credentials }));
vi.mock("./ssh", () => ({ sshConnect: h.prepare, sshTmuxCancel: h.cancel, sshDisconnectForReconnect: h.drop }));
vi.mock("@/stores/sessionStore", () => ({
  buildSshConnectOptions: async () => ({ keepaliveIntervalSecs: 3, keepaliveMax: 3 }),
  useSessionStore: {
    getState: () => ({ sessions: h.sessions, connect: h.connect, setActive: h.active, removeSession: h.remove }),
    setState: (update: (s: { sessions: TerminalSession[] }) => { sessions: TerminalSession[] }) => { h.sessions = update({ sessions: h.sessions }).sessions; },
  },
}));
import { createTmuxPicker } from "./tmuxPicker";

const connection = { id: "host-a", host: "example.test", port: 22, username: "alice" } as Connection;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

beforeEach(() => {
  vi.clearAllMocks(); h.sessions = [];
  h.credentials.mockResolvedValue({ username: "alice", password: "synthetic-test-password" });
  h.prepare.mockResolvedValue({ tmux_listing: { installed: true, sessions: [tmuxSession()] }, tmux_session: null });
  h.connect.mockImplementation(async (_connection: string, options: { sessionId: string }) => options.sessionId);
});

for (const status of ["connected", "connecting", "disconnected", "error"] as const) {
  test(`selecting an existing ${status} tab activates it without a new terminal connection`, async () => {
    h.sessions = [tmuxTab({ status })];
    const picker = createTmuxPicker(connection); await picker.ready;
    expect(await picker.attach(tmuxSession({ name: "renamed 中文" }))).toBe("tab-1");
    expect(h.active).toHaveBeenCalledWith("tab-1"); expect(h.connect).not.toHaveBeenCalled();
    expect(h.drop).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalled(); picker.close();
  });
}

test("rapid repeat taps share one open and preserve its confirmed choice", async () => {
  const gate = deferred<string>(); h.connect.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); await picker.ready;
  const first = picker.attach(tmuxSession()); const second = picker.attach(tmuxSession());
  expect(first).toBe(second); await Promise.resolve();
  expect(h.connect).toHaveBeenCalledTimes(1);
  const opts = h.connect.mock.calls[0][1]; gate.resolve(opts.sessionId);
  await first; expect(h.active).toHaveBeenCalledWith(opts.sessionId);
  picker.close(); expect(h.drop).not.toHaveBeenCalled();
});

test("cancel during authentication closes a late prepared connection and never opens a tab", async () => {
  const gate = deferred<{ tmux_listing: { installed: boolean; sessions: [] } }>(); h.prepare.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); await Promise.resolve(); await Promise.resolve();
  picker.close(); gate.resolve({ tmux_listing: { installed: true, sessions: [] } }); await picker.ready;
  await Promise.resolve(); expect(h.cancel).toHaveBeenCalled(); expect(h.connect).not.toHaveBeenCalled();
});

test("cancel before credentials finish does not even start an SSH probe", async () => {
  const gate = deferred<{ username: string }>(); h.credentials.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); picker.close(); gate.resolve({ username: "alice" });
  await expect(picker.ready).rejects.toThrow("TMUX_PICKER_CLOSED"); expect(h.prepare).not.toHaveBeenCalled();
});

test("cancel while opening cleans up only the newly owned tab", async () => {
  h.sessions = [tmuxTab({ id: "keep-existing", connectionId: "host-b" })];
  const gate = deferred<string>(); h.connect.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); await picker.ready;
  const pending = picker.attach(tmuxSession()); await Promise.resolve();
  const id = h.connect.mock.calls[0][1].sessionId; picker.close(); gate.resolve(id);
  await expect(pending).rejects.toThrow("TMUX_PICKER_CLOSED");
  expect(h.drop).toHaveBeenCalledWith(id); expect(h.remove).toHaveBeenCalledWith(id);
  expect(h.drop).not.toHaveBeenCalledWith("keep-existing");
});

test("ordinary SSH remains available when the tmux probe fails", async () => {
  h.prepare.mockRejectedValue(new Error("probe denied"));
  const picker = createTmuxPicker(connection); await expect(picker.ready).rejects.toThrow("probe denied");
  await picker.open(); expect(h.connect.mock.calls[0][1]).toMatchObject({ keepFailedSession: true, sshLaunch: { preparedId: undefined, choice: undefined } });
  picker.close();
});
