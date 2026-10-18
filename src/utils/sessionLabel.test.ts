// @vitest-environment jsdom
import { test, expect } from "vitest";
import type { TerminalSession } from "@/types";
import { normalizeTabTitle, sessionLabel, sessionMatchesQuery, splitTabLabel, TAB_TITLE_MAX } from "./sessionLabel";
import type { SplitTab } from "@/stores/layoutStore";

const session: TerminalSession = { id: "s1", connectionId: "c1", connectionName: "srv", status: "connected", type: "ssh" };

const tab: SplitTab = {
  id: "t1",
  root: { type: "leaf", id: "p1", sessionId: "s1" },
  activePaneId: "p1",
  maximizedPaneId: null,
  broadcastActive: false,
};

test("a session falls back to its connection name until it is given a title", () => {
  expect(sessionLabel(session)).toBe("srv");
  expect(sessionLabel({ ...session, title: "deploy" })).toBe("deploy");
});

test("a split tab shows its own name, else the active pane's session label", () => {
  expect(splitTabLabel(tab, session, "fallback")).toBe("srv");
  expect(splitTabLabel(tab, { ...session, title: "deploy" }, "fallback")).toBe("deploy");
  expect(splitTabLabel({ ...tab, name: "prod" }, { ...session, title: "deploy" }, "fallback")).toBe("prod");
});

test("a split tab with no active session left still names itself", () => {
  expect(splitTabLabel(tab, undefined, "fallback")).toBe("fallback");
  expect(splitTabLabel({ ...tab, name: "prod" }, undefined, "fallback")).toBe("prod");
});

test("a typed title is trimmed, capped, and cleared when it holds no text", () => {
  expect(normalizeTabTitle("  deploy  ")).toBe("deploy");
  expect(normalizeTabTitle("")).toBeUndefined();
  expect(normalizeTabTitle("   ")).toBeUndefined();
  expect(normalizeTabTitle(null)).toBeUndefined();
  expect(normalizeTabTitle("x".repeat(80))).toBe("x".repeat(TAB_TITLE_MAX));
});

test("a renamed session matches a search by tab name or by connection name", () => {
  const renamed = { ...session, title: "Deploy" };
  expect(sessionMatchesQuery(renamed, "depl")).toBe(true);
  expect(sessionMatchesQuery(renamed, "SRV")).toBe(true);
  expect(sessionMatchesQuery(renamed, "db")).toBe(false);
  expect(sessionMatchesQuery(session, "srv")).toBe(true);
});


test("an explicit custom name wins over automatic titles; clearing it restores the real mux name and round-trips", async () => {
  const { useSessionStore } = await import("@/stores/sessionStore");
  const { buildSnapshot, parseSnapshot } = await import("@/stores/workspaceSnapshotCore");
  const mode = { kind: "zellij" as const, session: { name: "live-session", socket_dir: "/tmp/original/contract_version_1", socket_id: "10:20" }, username: "alice", endpoint: "example.test:22" };
  useSessionStore.setState({ sessions: [{ ...session, sshMode: mode, title: "OSC shell title" }] });
  expect(sessionLabel(useSessionStore.getState().sessions[0])).toBe("live-session");
  useSessionStore.getState().renameSession("s1", "Deploy");
  const named = { ...useSessionStore.getState().sessions[0], title: "later OSC title" };
  expect(sessionLabel(named)).toBe("Deploy"); expect(sessionMatchesQuery(named, "live-session")).toBe(true);
  const snapshot = buildSnapshot({ sessions: [named], cwds: {}, activeSessionId: "s1", layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] } });
  expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))!.sessions[0].customTitle).toBe("Deploy");
  useSessionStore.getState().renameSession("s1", ""); expect(sessionLabel(useSessionStore.getState().sessions[0])).toBe("live-session");
});
