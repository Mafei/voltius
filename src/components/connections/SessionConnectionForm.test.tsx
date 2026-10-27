import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Connection } from "@/types";
import type { RemoteSession, SessionBackend, SessionListing } from "@/services/ssh";
import { tmuxSession } from "@/services/__fixtures__/tmux";
import { useSshSessionTypeStore } from "@/stores/sshSessionTypeStore";

const h = vi.hoisted(() => ({ create: vi.fn(), t: (key: string) => key, listening: true, android: false }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: h.t }), initReactI18next: { type: "3rdParty", init: () => {} } }));
vi.mock("@/services/tmuxPicker", () => ({ createSessionPicker: h.create }));
vi.mock("@/utils/platform", async (original) => ({ ...await original<typeof import("@/utils/platform")>(), useIsAndroid: () => h.android }));
vi.mock("@/services/backendErrors", async (original) => ({ ...await original<typeof import("@/services/backendErrors")>(), describeError: (e: Error) => e.message }));
vi.mock("@/components/terminal/connection-overlay/hooks", () => ({ useHostKeyConflict: () => ({ conflict: null, resolving: false, resolveConflict: vi.fn(), listening: h.listening }) }));
vi.mock("@/components/terminal/connection-overlay/HostKeyConflictPanel", () => ({ HostKeyConflictPanel: () => null }));
vi.mock("@/components/mobile/sheets/BottomSheet", () => ({ default: ({ children, onClose, onDismissStart }: {
  children: ReactNode; onClose: () => void; onDismissStart: () => void;
}) => <div><button onClick={() => { onDismissStart(); onClose(); }}>hardware-back</button>{children}</div> }));
import MobileSessionSheet from "@/components/mobile/sheets/TmuxSessionSheet";
import SessionConnectionForm from "./SessionConnectionForm";

const host = { id: "host-a", name: "服务器 A", host: "example.test", port: 22 } as Connection;
const remote = (backend: SessionBackend, name = "work"): RemoteSession => backend === "tmux"
  ? { backend, session: tmuxSession({ name }) }
  : backend === "tuios" ? { backend, session: { name, id: "synthetic-id", created: 1, saved: false, attached: false, window_count: 1 } }
  : { backend, session: { name, socket_dir: "/tmp/z/contract_version_1", socket_id: "10:20" } };
const listing = (backend: SessionBackend, sessions = [remote(backend)]): SessionListing => ({ backend, installed: true, version: `${backend} test`, sessions, reserved_names: sessions.map((s) => s.session.name) });
const fake = (value: SessionListing | null) => ({ ready: Promise.resolve(value), close: vi.fn(), open: vi.fn(async () => "tab"), attach: vi.fn(async () => "tab"), restore: vi.fn(async () => "tab") });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const typeSelect = () => screen.getByLabelText("mobile.session.type");
const listSelect = () => screen.getByLabelText("mobile.session.list");
const nameInput = () => screen.getByLabelText("mobile.session.name") as HTMLInputElement;
const connectButton = () => screen.getByRole("button", { name: "mobile.session.connect" }) as HTMLButtonElement;
function expectNameGroupHidden() {
  expect(screen.queryByLabelText("mobile.session.name")).toBeNull();
  for (const key of ["mobile.tmux.nameHint", "mobile.session.zellijNameHint", "mobile.session.duplicate"]) expect(screen.queryByText(key)).toBeNull();
}
async function choose(backend: SessionBackend) {
  fireEvent.change(typeSelect(), { target: { value: backend } });
  await waitFor(() => expect((listSelect() as HTMLSelectElement).disabled).toBe(false));
}
beforeEach(() => {
  vi.clearAllMocks(); h.listening = true; h.android = false; useSshSessionTypeStore.setState({ types: {} });
  h.create.mockImplementation((_connection: Connection, backend: SessionBackend | null) => fake(backend ? listing(backend) : null));
});
afterEach(cleanup);

async function renderAndroidPicker(backend: SessionBackend, sessions: RemoteSession[]) {
  h.android = true;
  const picker = fake(listing(backend, sessions));
  h.create.mockImplementation((_connection, selectedBackend) => selectedBackend ? picker : fake(null));
  render(<MobileSessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />);
  await choose(backend);
  return { picker, select: listSelect() as HTMLSelectElement };
}

for (const backend of ["tmux", "zellij", "tuios"] as const) {
  test(`Android ${backend}: removes the divider row, retains the non-option group heading and attaches the exact session`, async () => {
    const sessions = [remote(backend, "New"), remote(backend, "工作会话")];
    const { picker, select } = await renderAndroidPicker(backend, sessions);
    expect(Array.from(select.options, (option) => option.value)).toEqual(["", "create-new", "existing:0", "existing:1"]);
    expect(Array.from(select.children, (child) => child.tagName)).toEqual(["OPTION", "OPTION", "OPTGROUP"]);
    expect(select.options[1].textContent).toBe("＋ New");
    const group = select.querySelector("optgroup")!;
    expect(group.label).toBe("mobile.session.existing");
    expect(group.disabled).toBe(false);
    expect(group.hasAttribute("value")).toBe(false);
    expect(Array.from(group.children, (option) => (option as HTMLOptionElement).disabled)).toEqual([false, false]);
    fireEvent.change(select, { target: { value: "mobile.session.existing" } });
    expect(connectButton().disabled).toBe(true);
    expect(picker.open).not.toHaveBeenCalled(); expect(picker.attach).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "create-new" } });
    expect(nameInput()).toBeTruthy();
    fireEvent.change(select, { target: { value: "existing:1" } });
    expectNameGroupHidden(); fireEvent.click(connectButton());
    await waitFor(() => expect(picker.attach).toHaveBeenCalledWith(sessions[1]));
    expect(picker.open).not.toHaveBeenCalled();
  });
  test(`Android ${backend}: an empty list has no spacer or empty group and New still creates`, async () => {
    const { picker, select } = await renderAndroidPicker(backend, []);
    expect(Array.from(select.options, (option) => option.value)).toEqual(["", "create-new"]);
    expect(select.querySelector("optgroup")).toBeNull();
    fireEvent.change(select, { target: { value: "create-new" } });
    fireEvent.change(nameInput(), { target: { value: "手机会话" } });
    fireEvent.click(connectButton());
    await waitFor(() => expect(picker.open).toHaveBeenCalledWith({ backend, choice: { kind: "create", name: "手机会话" } }));
    expect(picker.attach).not.toHaveBeenCalled();
  });
}

for (const presentation of ["sheet", "dialog"] as const) {
  function SessionSheet(props: { connection: Connection; onClose: () => void; onOpened: () => void }) {
    return presentation === "sheet" ? <MobileSessionSheet {...props} /> : <SessionConnectionForm {...props} presentation="dialog" />;
  }
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

for (const backend of ["tmux", "zellij", "tuios"] as const) {
  test(`${backend}: the entire name group appears only for New, with its draft restored and irrelevant validation ignored`, async () => {
    render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose(backend);
    expectNameGroupHidden(); expect(connectButton().disabled).toBe(true);
    fireEvent.change(listSelect(), { target: { value: "create-new" } });
    fireEvent.change(nameInput(), { target: { value: "work" } });
    expect(connectButton().disabled).toBe(true); expect(screen.getByText("mobile.session.duplicate")).toBeTruthy();
    fireEvent.change(listSelect(), { target: { value: "existing:0" } });
    expectNameGroupHidden(); expect(connectButton().disabled).toBe(false);
    fireEvent.change(listSelect(), { target: { value: "create-new" } });
    expect(nameInput().value).toBe("work"); expect(connectButton().disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "new-draft" } });
    fireEvent.change(listSelect(), { target: { value: "existing:0" } });
    fireEvent.change(listSelect(), { target: { value: "create-new" } });
    expect(nameInput().value).toBe("new-draft"); expect(connectButton().disabled).toBe(false);
    expect(screen.getAllByRole("button", { name: "mobile.session.connect" })).toHaveLength(1);
    fireEvent.change(typeSelect(), { target: { value: "none" } }); expectNameGroupHidden();
  });
  test(`${backend}: existing target ignores new-name input and repeated Connect opens only once`, async () => {
    const picker = fake(listing(backend)); const gate = deferred<string>(); picker.attach.mockReturnValue(gate.promise);
    h.create.mockImplementation((_c, b) => b ? picker : fake(null));
    const opened = vi.fn(); render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={opened} />);
    await choose(backend); fireEvent.change(listSelect(), { target: { value: "create-new" } });
    fireEvent.change(nameInput(), { target: { value: "stale-new-name" } });
    fireEvent.change(listSelect(), { target: { value: "existing:0" } });
    expectNameGroupHidden();
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
    expectNameGroupHidden(); fireEvent.click(connectButton());
    await waitFor(() => expect(picker.attach).toHaveBeenCalledWith(remote(backend, "New")));
  });
  test(`${backend}: only New enables naming and Connect sends the exact Unicode name`, async () => {
    const picker = fake(listing(backend, [])); h.create.mockImplementation((_c, b) => b ? picker : fake(null));
    render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />); await choose(backend);
    expectNameGroupHidden(); expect(connectButton().disabled).toBe(true);
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
  expect((listSelect() as HTMLSelectElement).value).toBe(""); expectNameGroupHidden(); expect(connectButton().disabled).toBe(true);
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
  if (presentation === "sheet") fireEvent.click(screen.getByText("hardware-back")); else fireEvent.keyDown(document, { key: "Escape" }); expect(close).toHaveBeenCalled(); expect(picker.close).toHaveBeenCalled();
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
  if (presentation === "sheet") fireEvent.click(screen.getByText("hardware-back")); else fireEvent.keyDown(document, { key: "Escape" }); h.listening = true;
  view.rerender(<SessionSheet {...props} />); await Promise.resolve();
  expect(h.create).not.toHaveBeenCalled();
});

for (const authKind of ["password", "passphrase"] as const) {
  test(`${presentation}: ${authKind} unlocks the selected backend once without saving a secret or adding another Connect`, async () => {
    let retried = false;
    h.create.mockImplementation((_connection, backend, _id, options) => {
      if (!backend) return fake(null);
      if (options?.auth?.[authKind] === "synthetic-only") { retried = true; return fake(listing(backend)); }
      return { ...fake(null), ready: Promise.reject(new Error(authKind === "passphrase" ? "The key is encrypted" : "No authentication method provided")) };
    });
    render(<SessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />);
    fireEvent.change(typeSelect(), { target: { value: "zellij" } });
    const input = await screen.findByLabelText(authKind === "passphrase" ? "mobile.session.authPassphrase" : "mobile.session.authPassword");
    fireEvent.change(input, { target: { value: "synthetic-only" } });
    expect(screen.getAllByRole("button", { name: "mobile.session.connect" })).toHaveLength(1);
    fireEvent.click(connectButton()); await waitFor(() => expect(retried).toBe(true));
    await waitFor(() => expect((listSelect() as HTMLSelectElement).disabled).toBe(false));
  });
}

}

for (const presentation of ["sheet", "dialog"] as const) {
  test(`${presentation}: saved TUIOS sessions require the explicit Restore action`, async () => {
    const saved = remote("tuios");
    if (saved.backend !== "tuios") throw new Error("fixture backend");
    saved.session.saved = true;
    const picker = fake(listing("tuios", [saved]));
    h.create.mockImplementation((_connection, selected) => selected ? picker : fake(null));
    render(<SessionConnectionForm connection={host} onClose={vi.fn()} onOpened={vi.fn()} presentation={presentation} />);
    await choose("tuios");
    expect(screen.getByText(/mobile.session.tuiosSaved/)).toBeTruthy();
    expect(picker.restore).not.toHaveBeenCalled();
    fireEvent.change(listSelect(), { target: { value: "existing:0" } });
    expect(screen.getByText("mobile.session.tuiosRestoreHint")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mobile.session.restore" }));
    await waitFor(() => expect(picker.restore).toHaveBeenCalledWith(saved));
    expect(picker.attach).not.toHaveBeenCalled();
    expect(picker.open).not.toHaveBeenCalled();
  });
}
