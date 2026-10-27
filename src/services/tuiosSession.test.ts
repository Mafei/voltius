import { expect, test } from "vitest";
import type { RemoteSession } from "./ssh";
import { findSessionTab, modeForSession, sameRemoteSession, sessionAttachChoice } from "./tmuxSessionCore";
import { isSessionBackend, sessionBackendLabel, validTuiosName } from "./sessionTypes";
import { tmuxTab } from "./__fixtures__/tmux";
import { buildSnapshot, parseSnapshot } from "@/stores/workspaceSnapshotCore";
import { sessionLabel, sessionMatchesQuery } from "@/utils/sessionLabel";
import { sessionTypeForHost, useSshSessionTypeStore } from "@/stores/sshSessionTypeStore";

const remote: Extract<RemoteSession, { backend: "tuios" }> = {
  backend: "tuios", session: { id: "synthetic-uuid", name: "工作 ' $(printf BAD)", created: 123, saved: false, attached: false, window_count: 2 },
};

test("TUIOS identity survives renaming but not replacement, backend, account or endpoint changes", () => {
  const tab = tmuxTab({ sshMode: modeForSession(remote, "alice", "example.test:22") });
  const renamed = { ...remote, session: { ...remote.session, name: "renamed" } };
  expect(findSessionTab([tab], "host-a", "alice", renamed, "example.test:22")?.id).toBe(tab.id);
  for (const changed of [{ id: "new-id" }, { created: 124 }]) {
    expect(sameRemoteSession(remote, { ...remote, session: { ...remote.session, ...changed } })).toBe(false);
  }
  for (const [host, user, endpoint] of [["host-b", "alice", "example.test:22"], ["host-a", "bob", "example.test:22"], ["host-a", "alice", "elsewhere:22"]]) {
    expect(findSessionTab([tab], host, user, remote, endpoint)).toBeUndefined();
  }
  expect(sameRemoteSession(remote, { backend: "zellij", session: { name: remote.session.name, socket_dir: "/tmp/z", socket_id: "1:2" } })).toBe(false);
});

test("workspace restore retains identity and label, and reconnect always attaches without creating or resurrecting", () => {
  const tab = tmuxTab({ title: "shell", sshMode: modeForSession(remote, "alice", "example.test:22") });
  const snapshot = buildSnapshot({ sessions: [tab], cwds: {}, activeSessionId: tab.id,
    layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] } });
  const restored = parseSnapshot(JSON.parse(JSON.stringify(snapshot)))!;
  expect(restored.sessions[0].sshMode).toEqual(tab.sshMode);
  expect(restored.sessions[0].persist).toBe(false);
  expect(sessionLabel(restored.sessions[0])).toBe(remote.session.name);
  expect(sessionMatchesQuery(restored.sessions[0], "工作")).toBe(true);
  expect(sessionLabel({ ...restored.sessions[0], customTitle: "my label" })).toBe("my label");
  expect(sessionAttachChoice({ ...remote, session: { ...remote.session, saved: true } })).toEqual({ backend: "tuios", choice: { kind: "attach", session: { ...remote.session, saved: true } } });
  for (const malformed of [{ id: "" }, { created: -1 }, { name: "../escape" }, { saved: "true" }]) {
    const bad = JSON.parse(JSON.stringify(snapshot)); Object.assign(bad.sessions[0].sshMode.session, malformed);
    expect(parseSnapshot(bad)!.sessions).toEqual([]);
  }
});

test("TUIOS shares the device-local session preference and safe name rules", () => {
  expect(isSessionBackend("tuios")).toBe(true); expect(sessionBackendLabel.tuios).toBe("TUIOS");
  useSshSessionTypeStore.getState().setType("synthetic-tuios", "tuios");
  expect(sessionTypeForHost("synthetic-tuios")).toBe("tuios");
  for (const bad of ["", ".", "..", "a/b", "a\\b", " spaced", "trailing ", "-option", "bad\nname", "con", "LPT1.txt", "x".repeat(129)]) expect(validTuiosName(bad)).toBe(false);
  expect(validTuiosName(remote.session.name)).toBe(true);
});
