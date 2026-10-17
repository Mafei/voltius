import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Connection } from "@/types";
import type { RemoteSession, SessionBackend, SessionListing } from "@/services/ssh";
import { tmuxSession } from "@/services/__fixtures__/tmux";
import { useSshSessionTypeStore } from "@/stores/sshSessionTypeStore";

const h = vi.hoisted(() => ({ create: vi.fn(), t: (key: string) => key, listening: true }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: h.t }), initReactI18next: { type: "3rdParty", init: () => {} } }));
vi.mock("@/services/tmuxPicker", () => ({ createSessionPicker: h.create }));
vi.mock("@/services/backendErrors", () => ({ describeError: (e: Error) => e.message }));
vi.mock("@/components/terminal/connection-overlay/hooks", () => ({ useHostKeyConflict: () => ({ conflict: null, resolving: false, resolveConflict: vi.fn(), listening: h.listening }) }));
vi.mock("@/components/terminal/connection-overlay/HostKeyConflictPanel", () => ({ HostKeyConflictPanel: () => null }));
vi.mock("./BottomSheet", () => ({ default: ({ children, onClose, onDismissStart }: {
  children: ReactNode; onClose: () => void; onDismissStart: () => void;
}) => <div><button onClick={() => { onDismissStart(); onClose(); }}>hardware-back</button>{children}</div> }));
import SessionSheet from "./TmuxSessionSheet";

const host = { id: "host-a", name: "服务器 A", host: "example.test", port: 22 } as Connection;
const remote = (backend: SessionBackend, name = "work"): RemoteSession => backend === "tmux"
  ? { backend, session: tmuxSession({ name }) }
  : { backend, session: { name, socket_dir: "/tmp/z/contract_version_1", socket_id: "10:20" } };
const listing = (backend: SessionBackend, sessions = [remote(backend)]): SessionListing => ({ backend, installed: true, version: `${backend} test`, sessions, reserved_names: sessions.map((s) => s.session.name) });
const fake = (value: SessionListing | null) => ({ ready: Promise.resolve(value), close: vi.fn(), open: vi.fn(async () => "tab"), attach: vi.fn(async () => "tab") });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const typeSelect = () => screen.getByLabelText("mobile.session.type");
const listSelect = () => screen.getByLabelText("mobile.session.list");
const nameInput = () => screen.getByLabelText("mobile.session.name") as HTMLInputElement;
const connectButton = () => screen.getByRole("button", { name: "mobile.session.connect" }) as HTMLButtonElement;
async function choose(backend: SessionBackend) {
  fireEvent.change(typeSelect(), { target: { value: backend } });
  await waitFor(() => expect((listSelect() as HTMLSelectElement).disabled).toBe(false));
}
beforeEach(() => {
  vi.clearAllMocks(); h.listening = true; useSshSessionTypeStore.setState({ types: {} });
  h.create.mockImplementation((_connection: Connection, backend: SessionBackend | null) => fake(backend ? listing(backend) : null));
});
afterEach(cleanup);

test("None hides backend fields and uses the one Connect action for ordinary SSH", async () => {
  const plain = fake(null); h.create.mockReturnValue(plain);
  const opened = vi.fn(); render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={opened} />);
  await waitFor(() => expect(connectButton().disabled).toBe(false));
  expect(screen.queryByLabelText("mobile.session.list")).toBeNull();
  expect(screen.queryByLabelText("mobile.session.name")).toBeNull();
  expect(h.create).toHaveBeenCalledWith(host, null, expect.any(String));
  fireEvent.click(connectButton()); await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  expect(plain.open).toHaveBeenCalledWith(); expect(plain.attach).not.toHaveBeenCalled();
});

for (const backend of ["tmux", "zellij"] as const) {
  test(`${backend}: existing target ignores new-name input and repeated Connect opens only once`, async () => {
    const picker = fake(listing(backend)); const gate = deferred<string>(); picker.attach.mockReturnValue(gate.promise);
    h.create.mockImplementation((_c, b) => b ? picker : fake(null));
    const opened = vi.fn(); render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={opened} />);
    await choose(backend); fireEvent.change(listSelect(), { target: { value: "create-new" } });
    fireEvent.change(nameInput(), { target: { value: "stale-new-name" } });
    fireEvent.change(listSelect(), { target: { value: "existing:0" } });
    expect(nameInput().disabled).toBe(true); expect(nameInput().value).toBe("");
    fireEvent.click(connectButton()); fireEvent.click(screen.getByRole("button", { name: "mobile.session.opening" }));
    expect(picker.attach).toHaveBeenCalledTimes(1); expect(picker.attach).toHaveBeenCalledWith(remote(backend));
    expect(picker.open).not.toHaveBeenCalled(); gate.resolve("tab");
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  });
  test(`${backend}: New is an independent first item and a literal session named New remains existing`, async () => {
    const picker = fake(listing(backend, [remote(backend, "New")]));
    h.create.mockImplementation((_c, b) => b ? picker : fake(null));
    render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose(backend);
    const options = Array.from((listSelect() as HTMLSelectElement).options);
    expect(options.filter((o) => !o.disabled)[0].value).toBe("create-new");
    expect(options.find((o) => o.value === "separator")?.disabled).toBe(true);
    fireEvent.change(listSelect(), { target: { value: "existing:0" } });
    expect(nameInput().disabled).toBe(true); fireEvent.click(connectButton());
    await waitFor(() => expect(picker.attach).toHaveBeenCalledWith(remote(backend, "New")));
  });
  test(`${backend}: only New enables naming and Connect sends the exact Unicode name`, async () => {
    const picker = fake(listing(backend, [])); h.create.mockImplementation((_c, b) => b ? picker : fake(null));
    render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose(backend);
    expect(nameInput().disabled).toBe(true); expect(connectButton().disabled).toBe(true);
    fireEvent.change(listSelect(), { target: { value: "create-new" } }); expect(nameInput().disabled).toBe(false);
    expect(nameInput().type).toBe("text");
    fireEvent.change(nameInput(), { target: { value: "工作 ' $shell;" } }); fireEvent.click(connectButton());
    await waitFor(() => expect(picker.open).toHaveBeenCalledWith({ backend, choice: { kind: "create", name: "工作 ' $shell;" } }));
  });
}

test("duplicate and invalid New names disable Connect without creating a session", async () => {
  render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose("zellij");
  fireEvent.change(listSelect(), { target: { value: "create-new" } });
  for (const value of ["", " ", "-bad", "a/b", "..", "x".repeat(49), "work"]) {
    fireEvent.change(nameInput(), { target: { value } }); expect(connectButton().disabled).toBe(true);
  }
  expect(screen.getByRole("alert").textContent).toContain("mobile.session.duplicate");
});

test("rapid type changes and switching None discard old lists, target and name", async () => {
  const tmuxGate = deferred<SessionListing | null>(), zellijGate = deferred<SessionListing | null>();
  const old = fake(null), latest = fake(null); old.ready = tmuxGate.promise; latest.ready = zellijGate.promise;
  h.create.mockImplementation((_c, b) => b === "tmux" ? old : b === "zellij" ? latest : fake(null));
  render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />);
  fireEvent.change(typeSelect(), { target: { value: "tmux" } }); expect(connectButton().disabled).toBe(true);
  fireEvent.change(typeSelect(), { target: { value: "zellij" } });
  zellijGate.resolve(listing("zellij")); await waitFor(() => expect((listSelect() as HTMLSelectElement).disabled).toBe(false));
  tmuxGate.resolve(listing("tmux", [remote("tmux", "STALE")])); await Promise.resolve();
  expect(screen.queryByText(/STALE/)).toBeNull(); expect(old.close).toHaveBeenCalled();
  fireEvent.change(listSelect(), { target: { value: "create-new" } }); fireEvent.change(nameInput(), { target: { value: "discard me" } });
  fireEvent.change(typeSelect(), { target: { value: "none" } });
  await waitFor(() => expect(connectButton().disabled).toBe(false));
  expect(screen.queryByLabelText("mobile.session.list")).toBeNull(); expect(latest.close).toHaveBeenCalled();
});

test("refresh cannot turn a disappeared existing target into New", async () => {
  let count = 0; h.create.mockImplementation((_c, b) => b ? fake(listing(b, count++ ? [] : [remote(b)])) : fake(null));
  render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose("tmux");
  fireEvent.change(listSelect(), { target: { value: "existing:0" } });
  fireEvent.click(screen.getByRole("button", { name: "mobile.session.refresh" }));
  await screen.findByText("mobile.session.changed");
  expect((listSelect() as HTMLSelectElement).value).toBe(""); expect(nameInput().disabled).toBe(true); expect(connectButton().disabled).toBe(true);
});

test("missing backend keeps type selection available and None uses ordinary SSH", async () => {
  h.create.mockImplementation((_c, b) => fake(b ? { ...listing(b), installed: false, sessions: [] } : null));
  render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await chooseMissing();
  expect(connectButton().disabled).toBe(true); expect((typeSelect() as HTMLSelectElement).disabled).toBe(false);
  fireEvent.change(typeSelect(), { target: { value: "none" } }); await waitFor(() => expect(connectButton().disabled).toBe(false));
  async function chooseMissing() { fireEvent.change(typeSelect(), { target: { value: "zellij" } }); await screen.findByText("mobile.session.missing"); }
});

test("failed Connect stays in the form and can retry through a fresh picker", async () => {
  const first = fake(listing("zellij")), second = fake(listing("zellij"));
  first.open.mockRejectedValue(new Error("temporary network failure")); let calls = 0;
  h.create.mockImplementation((_c, b) => b ? (calls++ ? second : first) : fake(null));
  render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose("zellij");
  fireEvent.change(listSelect(), { target: { value: "create-new" } }); fireEvent.change(nameInput(), { target: { value: "retry-name" } });
  fireEvent.click(connectButton()); await screen.findByText("temporary network failure");
  await waitFor(() => expect(connectButton().disabled).toBe(false)); expect(nameInput().value).toBe("retry-name");
  fireEvent.click(connectButton()); await waitFor(() => expect(second.open).toHaveBeenCalledTimes(1));
});

test("hardware back cancels a late connection without opening or changing the view", async () => {
  const picker = fake(null), gate = deferred<string>(); picker.open.mockReturnValue(gate.promise); h.create.mockReturnValue(picker);
  const close = vi.fn(), opened = vi.fn(); render(<SessionSheet connection={host} onClose={close} onOpened={opened} />);
  await waitFor(() => expect(connectButton().disabled).toBe(false)); fireEvent.click(connectButton());
  fireEvent.click(screen.getByText("hardware-back")); expect(close).toHaveBeenCalled(); expect(picker.close).toHaveBeenCalled();
  gate.resolve("tab"); await Promise.resolve(); expect(opened).not.toHaveBeenCalled();
});

test("Session Type is remembered per host", async () => {
  const first = render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose("zellij");
  first.unmount(); render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />);
  expect((typeSelect() as HTMLSelectElement).value).toBe("zellij");
  expect(useSshSessionTypeStore.getState().types[host.id]).toBe("zellij");
});

test("a host-key listener that becomes ready after Cancel cannot start a new probe", async () => {
  h.listening = false;
  const props = { connection: host, onClose: vi.fn(), onOpened: vi.fn() };
  const view = render(<SessionSheet {...props} />);
  fireEvent.click(screen.getByText("hardware-back")); h.listening = true;
  view.rerender(<SessionSheet {...props} />); await Promise.resolve();
  expect(h.create).not.toHaveBeenCalled();
});
