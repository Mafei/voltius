import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { tmuxSession, tmuxTab } from "@/services/__fixtures__/tmux";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

afterEach(cleanup);

// Task 9: this is the persistent terminal-tab chrome — the case the notification-bell
// mobile gap matters most for, since a teammate blocked on a control request is sitting
// in an active session, not on the hosts/snippets/more tabs.
describe("MobileTerminalTopBar", () => {
  test("mounts the notification bell alongside its existing trailing icons", async () => {
    const { default: MobileTerminalTopBar } = await import("./MobileTerminalTopBar");
    const { container } = render(<MobileTerminalTopBar />);
    expect(container.querySelector('[title="notifications.bell.title"]')).not.toBeNull();
  });
});

test("a session chip carries the name the tab was given, not the connection", async () => {
  useSessionStore.setState({
    sessions: [{ id: "s1", connectionId: "c1", connectionName: "web-01", title: "deploy", status: "connected", type: "local" }],
    activeSessionId: "s1",
  });
  const { default: MobileTerminalTopBar } = await import("./MobileTerminalTopBar");
  const { container } = render(<MobileTerminalTopBar />);

  expect(container.querySelector('[data-mobile-session-chip="s1"]')!.textContent).toContain("deploy");
});

test("tmux chips distinguish sessions on one host and the same name across hosts", async () => {
  useSessionStore.setState({ sessions: [tmuxTab({ title: "shell must not overwrite" }),
    tmuxTab({ id: "second", sshMode: { kind: "tmux", session: tmuxSession({ id: "$1", name: "部署" }), username: "alice", endpoint: "example.test:22" } }),
    tmuxTab({ id: "other-host", connectionId: "host-b", connectionName: "服务器 B" })], activeSessionId: "tab-1" });
  const { default: MobileTerminalTopBar } = await import("./MobileTerminalTopBar");
  const { container } = render(<MobileTerminalTopBar />);
  expect(container.querySelector('[data-mobile-session-chip="tab-1"]')!.textContent).toContain(tmuxSession().name);
  expect(container.querySelector('[data-mobile-session-chip="second"]')!.textContent).toContain("部署");
  expect(container.querySelector('[data-mobile-session-chip="other-host"]')!.textContent).toContain("服务器 B");
  expect(container.textContent).not.toContain("shell must not overwrite");
});

test("same session name on tmux and Zellij keeps a visible backend and the real title", async () => {
  useSessionStore.setState({ sessions: [tmuxTab({ title: "ignored" }), tmuxTab({ id: "zellij",
    sshMode: { kind: "zellij", session: { name: tmuxSession().name, socket_dir: "/tmp/original/contract_version_1", socket_id: "10:20" }, username: "alice", endpoint: "example.test:22" } })], activeSessionId: "zellij" });
  const { default: MobileTerminalTopBar } = await import("./MobileTerminalTopBar");
  const { container } = render(<MobileTerminalTopBar />);
  expect(container.querySelector('[data-mobile-session-chip="tab-1"]')!.textContent).toContain("Tmux");
  expect(container.querySelector('[data-mobile-session-chip="zellij"]')!.textContent).toContain("Zellij");
  expect(container.querySelector('[data-mobile-session-chip="zellij"]')!.textContent).toContain(tmuxSession().name);
  expect(container.textContent).not.toContain("ignored");
});

test("long mobile labels retain complete accessible identity and separate activate/close targets", async () => {
  const original = { setActive: useSessionStore.getState().setActive, disconnect: useSessionStore.getState().disconnect };
  const setActive = vi.fn(), disconnect = vi.fn(async () => {});
  const name = "合成会话-gjpqy-é-very-long-mobile-session";
  const session = tmuxTab({ id: "mobile-long", customTitle: name,
    sshMode: { kind: "zellij", session: { name: "synthetic-remote", socket_dir: "/synthetic", socket_id: "1:2" }, username: "alice", endpoint: "synthetic.example.invalid:22" } });
  useSessionStore.setState({ sessions: [session], activeSessionId: session.id, setActive, disconnect });
  try {
    const { default: MobileTerminalTopBar } = await import("./MobileTerminalTopBar");
    render(<MobileTerminalTopBar />);
    const label = screen.getByRole("button", { name: `${name} · Zellij · alice@${session.connectionName} · alice@synthetic.example.invalid:22` });
    expect(label.getAttribute("title")).toContain(name);
    expect(label.getAttribute("title")).toContain("alice@synthetic.example.invalid:22");
    expect(label.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(label); expect(setActive).toHaveBeenCalledWith("mobile-long");
    const close = screen.getByRole("button", { name: `common.action.close: ${name}` });
    fireEvent.touchStart(close, { touches: [{ clientX: 100, clientY: 20 }] });
    fireEvent.touchMove(close, { touches: [{ clientX: 40, clientY: 20 }] });
    fireEvent.click(close); expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(close);
    expect(disconnect).toHaveBeenCalledWith("mobile-long");
    expect(setActive).toHaveBeenCalledTimes(1);
  } finally { useSessionStore.setState(original); }
});
