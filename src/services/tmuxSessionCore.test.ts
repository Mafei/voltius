import { test, expect } from "vitest";
import { findTmuxTab, sameTmux, tmuxAttachChoice, findSessionTab, modeForSession, sameRemoteSession, sessionAttachChoice } from "./tmuxSessionCore";
import { tmuxSession, tmuxTab } from "./__fixtures__/tmux";
import { sessionLabel, sessionMatchesQuery } from "@/utils/sessionLabel";
import { buildSnapshot, parseSnapshot } from "@/stores/workspaceSnapshotCore";

test("identity uses connection, login user and remote session identity, never its name", () => {
  const target = tmuxSession();
  const tabs = [tmuxTab(), tmuxTab({ id: "host-b", connectionId: "host-b" }),
    tmuxTab({ id: "bob", sshMode: { kind: "tmux", session: target, username: "bob", endpoint: "example.test:22" } })];
  expect(findTmuxTab(tabs, "host-a", "alice", target, "example.test:22")?.id).toBe("tab-1");
  expect(findTmuxTab(tabs, "host-b", "alice", target, "example.test:22")?.id).toBe("host-b");
  expect(findTmuxTab(tabs, "host-a", "bob", target, "example.test:22")?.id).toBe("bob");
  expect(findTmuxTab(tabs, "host-c", "alice", target, "example.test:22")).toBeUndefined();
  expect(findTmuxTab(tabs, "host-a", "alice", target, "changed.test:22")).toBeUndefined();
  expect(sameTmux(target, tmuxSession({ name: "renamed" }))).toBe(true);
  for (const different of [{ id: "$1" }, { created: 124 }, { server_pid: 43 }]) {
    expect(sameTmux(target, tmuxSession(different))).toBe(false);
  }
  expect(tmuxAttachChoice(target)).toEqual({ kind: "attach", id: "$0", created: 123, serverPid: 42 });
});

test("tmux names take precedence over shell/custom titles without changing ordinary SSH labels", () => {
  const tab = tmuxTab({ title: "remote shell title" });
  expect(sessionLabel(tab)).toBe(tmuxSession().name);
  expect(sessionMatchesQuery(tab, "工作")).toBe(true);
  expect(sessionMatchesQuery(tab, "服务器 A")).toBe(true);
  expect(sessionLabel({ connectionName: "host-a", title: undefined })).toBe("host-a");
});

test("tmux identity, Chinese/special names and login survive snapshot round trip", () => {
  const tab = tmuxTab();
  const snapshot = buildSnapshot({ sessions: [tab], cwds: {}, activeSessionId: tab.id,
    layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] } });
  const restored = parseSnapshot(JSON.parse(JSON.stringify(snapshot)))!;
  expect(restored.sessions[0].sshMode).toEqual(tab.sshMode);
  expect(restored.sessions[0].persist).toBe(false);
  expect(sessionLabel(restored.sessions[0])).toBe(tmuxSession().name);
  const bad = JSON.parse(JSON.stringify(snapshot));
  bad.sessions[0].sshMode.session.id = "$0; kill-server";
  expect(parseSnapshot(bad)!.sessions).toEqual([]);
});

test("backend, endpoint, login and original Zellij socket separate same-name sessions", () => {
  const remote = { backend: "zellij" as const, session: { name: tmuxSession().name, socket_dir: "/tmp/original/contract_version_1", socket_id: "10:20" } };
  const tab = tmuxTab({ id: "zellij", sshMode: modeForSession(remote, "alice", "example.test:22") });
  const all = [tmuxTab(), tab];
  expect(findSessionTab(all, "host-a", "alice", remote, "example.test:22")?.id).toBe("zellij");
  for (const [host, login, endpoint] of [["host-b","alice","example.test:22"],["host-a","bob","example.test:22"],["host-a","alice","other.test:22"]]) {
    expect(findSessionTab(all, host, login, remote, endpoint)).toBeUndefined();
  }
  expect(sameRemoteSession(remote, { backend: "tmux", session: tmuxSession() })).toBe(false);
  expect(sameRemoteSession(remote, { ...remote, session: { ...remote.session, socket_id: "10:21" } })).toBe(false);
  expect(sameRemoteSession(remote, { ...remote, session: { ...remote.session, socket_dir: "/tmp/another/contract_version_1" } })).toBe(false);
  expect(sameRemoteSession(remote, { ...remote, session: { ...remote.session, name: "renamed" } })).toBe(true);
});

test("Zellij snapshot restores the bound running target and never requests creation or resurrection", () => {
  const remote = { backend: "zellij" as const, session: { name: "New", socket_dir: "/tmp/original/contract_version_1", socket_id: "10:20" } };
  const tab = tmuxTab({ sshMode: modeForSession(remote,"alice","example.test:22") });
  const snapshot = buildSnapshot({ sessions: [tab], cwds: {}, activeSessionId: tab.id,
    layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] } });
  const restored = parseSnapshot(JSON.parse(JSON.stringify(snapshot)))!;
  expect(restored.sessions[0].sshMode).toEqual(tab.sshMode);
  expect(sessionLabel(restored.sessions[0])).toBe("New");
  expect(sessionAttachChoice(remote)).toEqual({ backend: "zellij", choice: { kind: "attach", session: remote.session } });
  const bad = JSON.parse(JSON.stringify(snapshot)); delete bad.sessions[0].sshMode.session.socket_id;
  expect(parseSnapshot(bad)!.sessions).toEqual([]);
});
