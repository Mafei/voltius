import { beforeEach, expect, test, vi } from "vitest";
import type { Connection, TerminalSession } from "@/types";
import { tmuxSession, tmuxTab } from "./__fixtures__/tmux";

const h = vi.hoisted(() => ({
  prepare: vi.fn(), cancel: vi.fn(async () => {}), drop: vi.fn(async () => {}),
  credentials: vi.fn(), reconnect: vi.fn(), connect: vi.fn(), direct: vi.fn(), active: vi.fn(), remove: vi.fn(),
  sessions: [] as TerminalSession[],
}));
vi.mock("./credentials", () => ({ resolveConnectionCredentials: h.credentials }));
vi.mock("./ssh", () => ({ sshConnect: h.prepare, sshSessionCancel: h.cancel, sshDisconnect: h.drop }));
vi.mock("@/stores/sessionStore", () => ({
  buildSshConnectOptions: async () => ({ keepaliveIntervalSecs: 3, keepaliveMax: 3 }),
  useSessionStore: {
    getState: () => ({ sessions: h.sessions, connect: h.connect, connectDirect: h.direct, reconnect: h.reconnect, setActive: h.active, removeSession: h.remove }),
    setState: (update: (s: { sessions: TerminalSession[] }) => { sessions: TerminalSession[] }) => { h.sessions = update({ sessions: h.sessions }).sessions; },
  },
}));
import { createTmuxPicker, createSessionPicker } from "./tmuxPicker";
import { findSessionPane, useLayoutStore } from "@/stores/layoutStore";

const remote = (session = tmuxSession()) => ({ backend: "tmux" as const, session });
const listed = () => ({ backend: "tmux" as const, installed: true, version: "tmux 3.4", sessions: [remote()], reserved_names: [tmuxSession().name] });

const connection = { id: "host-a", host: "example.test", port: 22, username: "alice" } as Connection;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

beforeEach(() => {
  vi.clearAllMocks(); h.sessions = [];
  useLayoutStore.setState(useLayoutStore.getInitialState());
  h.credentials.mockResolvedValue({ username: "alice", password: "synthetic-test-password" });
  h.prepare.mockResolvedValue({ session_listing: listed(), session: null });
  h.connect.mockImplementation(async (_connection: string, options: { sessionId: string }) => options.sessionId);
  h.direct.mockResolvedValue(undefined);
});

test("desktop reuses and reveals a target's existing split pane", async () => {
  h.sessions = [tmuxTab()];
  useLayoutStore.getState().createSplitTab("tab-1", "sibling", "right");
  const owner = findSessionPane(useLayoutStore.getState().splitTabs, "tab-1")!;
  const sibling = findSessionPane(useLayoutStore.getState().splitTabs, "sibling")!;
  useLayoutStore.getState().setMaximized(sibling.paneId); useLayoutStore.getState().setSplitTabActive(false);
  const picker = createTmuxPicker(connection); await picker.ready; expect(await picker.attach(remote())).toBe("tab-1");
  expect(useLayoutStore.getState()).toMatchObject({ splitTabActive: true, activeSplitTabId: owner.tabId, activePaneId: owner.paneId, maximizedPaneId: owner.paneId });
  expect(h.active).toHaveBeenCalledWith("tab-1"); expect(h.connect).not.toHaveBeenCalled(); picker.close();
});

test("desktop direct targets share the prepared picker and never resolve as an absent saved host", async () => {
  const picker = createSessionPicker(connection, "tmux", "prepared-direct", { direct: true, auth: { passphrase: "synthetic-only" } });
  await picker.ready; await picker.attach(remote()); expect(h.connect).not.toHaveBeenCalled();
  expect(h.direct).toHaveBeenCalledWith(connection, expect.objectContaining({ sshLaunch: expect.objectContaining({ preparedId: "prepared-direct" }) }));
  expect(h.prepare.mock.calls[0][0].passphrase).toBe("synthetic-only"); picker.close();
});

for (const status of ["connected", "connecting", "disconnected", "error"] as const) {
  test(`selecting an existing ${status} tab activates it without a new terminal connection`, async () => {
    h.sessions = [tmuxTab({ status })];
    const picker = createTmuxPicker(connection); await picker.ready;
    expect(await picker.attach(remote(tmuxSession({ name: "renamed 中文" })))).toBe("tab-1");
    expect(h.active).toHaveBeenCalledWith("tab-1"); expect(h.connect).not.toHaveBeenCalled();
    expect(h.drop).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
    expect(h.cancel).toHaveBeenCalled(); picker.close();
  });
}

test("rapid repeat taps share one open and preserve its confirmed choice", async () => {
  const gate = deferred<string>(); h.connect.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); await picker.ready;
  const first = picker.attach(remote()); const second = picker.attach(remote());
  expect(first).toBe(second); await Promise.resolve();
  expect(h.connect).toHaveBeenCalledTimes(1);
  const opts = h.connect.mock.calls[0][1]; gate.resolve(opts.sessionId);
  await first; expect(h.active).toHaveBeenCalledWith(opts.sessionId);
  picker.close(); expect(h.drop).not.toHaveBeenCalled();
});

test("cancel during authentication closes a late prepared connection and never opens a tab", async () => {
  const gate = deferred<{ session_listing: ReturnType<typeof listed> }>(); h.prepare.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); await Promise.resolve(); await Promise.resolve();
  picker.close(); gate.resolve({ session_listing: listed() }); await picker.ready;
  await Promise.resolve(); expect(h.cancel).toHaveBeenCalled(); expect(h.connect).not.toHaveBeenCalled();
});

test("cancel before credentials finish does not even start an SSH probe", async () => {
  const gate = deferred<{ username: string }>(); h.credentials.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); picker.close(); gate.resolve({ username: "alice" });
  await expect(picker.ready).rejects.toThrow("SESSION_PICKER_CLOSED"); expect(h.prepare).not.toHaveBeenCalled();
});

test("cancel while opening cleans up only the newly owned tab", async () => {
  h.sessions = [tmuxTab({ id: "keep-existing", connectionId: "host-b" })];
  const gate = deferred<string>(); h.connect.mockReturnValue(gate.promise);
  const picker = createTmuxPicker(connection); await picker.ready;
  const pending = picker.attach(remote()); await Promise.resolve();
  const id = h.connect.mock.calls[0][1].sessionId; picker.close(); gate.resolve(id);
  await expect(pending).rejects.toThrow("SESSION_PICKER_CLOSED");
  expect(h.drop).toHaveBeenCalledWith(id, undefined, false, false); expect(h.remove).toHaveBeenCalledWith(id);
  expect(h.drop).not.toHaveBeenCalledWith("keep-existing");
});

test("ordinary SSH remains available when the tmux probe fails", async () => {
  h.prepare.mockRejectedValue(new Error("probe denied"));
  const picker = createTmuxPicker(connection); await expect(picker.ready).rejects.toThrow("probe denied");
  await picker.open(); expect(h.connect.mock.calls[0][1]).toMatchObject({ keepFailedSession: true, sshLaunch: { preparedId: undefined, choice: undefined } });
  picker.close();
});

test("None opens ordinary SSH without resolving a picker credential or probing either backend", async () => {
  const picker = createSessionPicker(connection, null); expect(await picker.ready).toBeNull();
  expect(h.prepare).not.toHaveBeenCalled(); expect(h.credentials).not.toHaveBeenCalled();
  await picker.open();
  expect(h.connect.mock.calls[0][1]).toMatchObject({ sshLaunch: { preparedId: undefined, choice: undefined } });
  picker.close(); expect(h.cancel).not.toHaveBeenCalled();
});

for (const status of ["connected", "connecting", "disconnected", "error"] as const) {
  test(`Zellij ${status} tab is reused by original socket identity and refreshed real name`, async () => {
    const session = { name: "New", socket_dir: "/tmp/z/contract_version_1", socket_id: "10:20" };
    const selected = { backend: "zellij" as const, session: { ...session, name: "renamed 中文" } };
    h.sessions = [tmuxTab({ status, sshMode: { kind: "zellij", session, username: "alice", endpoint: "example.test:22" } })];
    h.prepare.mockResolvedValue({ session_listing: { backend: "zellij", installed: true, version: "zellij 0.45.1", sessions: [selected], reserved_names: [selected.session.name] } });
    const picker = createSessionPicker(connection, "zellij"); await picker.ready;
    expect(await picker.attach(selected)).toBe("tab-1"); expect(h.connect).not.toHaveBeenCalled();
    expect(h.sessions[0].sshMode).toMatchObject({ kind: "zellij", session: selected.session });
    picker.close();
  });
}

test("a same-name tmux tab cannot consume a Zellij selection or a mismatched backend choice", async () => {
  h.sessions = [tmuxTab()];
  const selected = { backend: "zellij" as const, session: { name: tmuxSession().name, socket_dir: "/tmp/z/contract_version_1", socket_id: "10:20" } };
  h.prepare.mockResolvedValue({ session_listing: { backend: "zellij", installed: true, version: "zellij 0.45.1", sessions: [selected], reserved_names: [selected.session.name] } });
  const picker = createSessionPicker(connection, "zellij"); await picker.ready;
  await expect(picker.open({ backend: "tmux", choice: { kind: "create", name: "work" } })).rejects.toThrow("SESSION_BACKEND_CHANGED");
  await picker.attach(selected); expect(h.connect).toHaveBeenCalledTimes(1); picker.close();
});

const tuiosRemote = (saved = false) => ({ backend: "tuios" as const, session: { name: "work", id: "synthetic-id", created: 123, saved, window_count: 1, attached: false } });
function tuiosListing(saved = false) { const selected = tuiosRemote(saved); return { session_listing: { backend: "tuios", installed: true, version: "tuios synthetic", sessions: [selected], reserved_names: [selected.session.name] } }; }

test("TUIOS duplicate clicks share one launch and retain the typed target", async () => {
  h.prepare.mockResolvedValue(tuiosListing());
  const picker = createSessionPicker(connection, "tuios"); await picker.ready;
  const target = tuiosRemote(); const first = picker.attach(target), second = picker.attach(target);
  expect(first).toBe(second); await first;
  expect(h.connect).toHaveBeenCalledTimes(1);
  expect(h.connect.mock.calls[0][1]).toMatchObject({ sshLaunch: { choice: { backend: "tuios", choice: { kind: "attach", session: target.session } } } });
});

test("saved TUIOS restore reuses an offline tab without duplicating it", async () => {
  const selected = tuiosRemote(true); selected.session.id = ""; selected.session.created = 0;
  h.prepare.mockResolvedValue(tuiosListing(true));
  h.sessions = [tmuxTab({ status: "disconnected", sshMode: { kind: "tuios", session: tuiosRemote().session, username: "alice", endpoint: "example.test:22" } })];
  h.reconnect.mockImplementation(async () => {
    h.sessions[0].status = "connected";
    if (h.sessions[0].sshMode?.kind === "tuios") h.sessions[0].sshMode.session.saved = false;
  });
  const picker = createSessionPicker(connection, "tuios"); await picker.ready;
  expect(await picker.restore(selected)).toBe("tab-1");
  expect(h.reconnect).toHaveBeenCalledWith("tab-1", expect.objectContaining({ sshLaunch: expect.objectContaining({ choice: { backend: "tuios", choice: { kind: "restore", session: selected.session, expected: { id: "synthetic-id" } } } }) }));
  expect(h.connect).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
  expect(h.sessions[0].sshMode).toMatchObject({ kind: "tuios", session: { saved: false } });
});

test("TUIOS restore refuses a live selection and does not issue a create", async () => {
  h.prepare.mockResolvedValue(tuiosListing());
  const picker = createSessionPicker(connection, "tuios"); await picker.ready;
  await expect(picker.restore(tuiosRemote())).rejects.toThrow("SESSION_CHANGED");
  expect(h.connect).not.toHaveBeenCalled(); expect(h.reconnect).not.toHaveBeenCalled();
});
