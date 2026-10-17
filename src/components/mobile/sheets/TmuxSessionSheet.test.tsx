import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Connection } from "@/types";
import { tmuxSession } from "@/services/__fixtures__/tmux";

const h = vi.hoisted(() => ({ create: vi.fn(), t: (key: string) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: h.t }), initReactI18next: { type: "3rdParty", init: () => {} } }));
vi.mock("@/services/tmuxPicker", () => ({ createTmuxPicker: h.create }));
vi.mock("@/services/backendErrors", () => ({ describeError: (e: Error) => e.message }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/terminal/connection-overlay/hooks", () => ({ useHostKeyConflict: () => ({ conflict: null, resolving: false, resolveConflict: vi.fn(), listening: true }) }));
vi.mock("@/components/terminal/connection-overlay/HostKeyConflictPanel", () => ({ HostKeyConflictPanel: () => null }));
vi.mock("./BottomSheet", () => ({ default: ({ children, onClose, onDismissStart }: {
  children: ReactNode; onClose: () => void; onDismissStart: () => void;
}) => <div><button onClick={() => { onDismissStart(); onClose(); }}>hardware-back</button>{children}</div> }));
import TmuxSessionSheet from "./TmuxSessionSheet";

const host = { id: "host-a", name: "服务器 A", host: "example.test", port: 22 } as Connection;
const fake = (listing = { installed: true, sessions: [tmuxSession()] }) => ({
  ready: Promise.resolve(listing), close: vi.fn(), open: vi.fn(async () => "tab"), attach: vi.fn(async () => "tab"),
});
beforeEach(() => { vi.clearAllMocks(); h.create.mockReturnValue(fake()); });
afterEach(cleanup);

test("lists the real name as text and confirms a selection only once on repeated taps", async () => {
  const picker = fake(); let finish!: (s: string) => void;
  picker.attach.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; })); h.create.mockReturnValue(picker);
  const opened = vi.fn(); render(<TmuxSessionSheet connection={host} onClose={vi.fn()} onOpened={opened} />);
  const row = await screen.findByText(new RegExp("工作")); fireEvent.click(row); fireEvent.click(row);
  expect(picker.attach).toHaveBeenCalledTimes(1); expect(picker.attach).toHaveBeenCalledWith(tmuxSession());
  finish("tab"); await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
});

test("empty list offers explicit creation with the exact typed Unicode name", async () => {
  const picker = fake({ installed: true, sessions: [] }); h.create.mockReturnValue(picker);
  render(<TmuxSessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />);
  await screen.findByText("mobile.tmux.empty");
  const input = screen.getByLabelText("mobile.tmux.newName"); expect(input.getAttribute("type")).toBe("text");
  fireEvent.change(input, { target: { value: "工作 ' $shell;" } }); fireEvent.click(screen.getByText("mobile.tmux.create"));
  await waitFor(() => expect(picker.open).toHaveBeenCalledWith({ kind: "create", name: "工作 ' $shell;" }));
});

test("missing tmux preserves ordinary SSH and never offers automatic installation", async () => {
  const picker = fake({ installed: false, sessions: [] }); h.create.mockReturnValue(picker);
  render(<TmuxSessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />);
  await screen.findByText("mobile.tmux.missing"); expect(screen.queryByText("mobile.tmux.create")).toBeNull();
  fireEvent.click(screen.getByText("mobile.tmux.plain")); await waitFor(() => expect(picker.open).toHaveBeenCalledWith());
});

test("a duplicate name displays an error and requires refresh before another operation", async () => {
  const picker = fake(); picker.open.mockRejectedValue(new Error("TMUX_CHOICE_FAILED: duplicate session: work")); h.create.mockReturnValue(picker);
  render(<TmuxSessionSheet connection={host} onClose={vi.fn()} onOpened={vi.fn()} />);
  const input = await screen.findByLabelText("mobile.tmux.newName"); fireEvent.change(input, { target: { value: "work" } });
  fireEvent.click(screen.getByText("mobile.tmux.create")); expect((await screen.findByRole("alert")).textContent).toContain("mobile.tmux.duplicate");
  expect((screen.getByText("mobile.tmux.create") as HTMLButtonElement).disabled).toBe(true);
});

test("hardware back immediately closes owned work without selecting or creating", async () => {
  const picker = fake(); h.create.mockReturnValue(picker); const close = vi.fn();
  render(<TmuxSessionSheet connection={host} onClose={close} onOpened={vi.fn()} />);
  fireEvent.click(screen.getByText("hardware-back")); expect(picker.close).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
  expect(picker.open).not.toHaveBeenCalled(); expect(picker.attach).not.toHaveBeenCalled();
});
