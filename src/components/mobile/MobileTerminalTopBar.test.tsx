import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
