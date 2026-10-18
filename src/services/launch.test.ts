// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({ connect: vi.fn(async () => "tab"), direct: vi.fn(async () => {}), mobile: false }));
vi.mock("@/utils/platform", () => ({ isMobileShell: () => h.mobile }));
import { launchHost, launchQuickConnect } from "./launch";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSessionConnectionStore } from "@/stores/sessionConnectionStore";
import type { Connection } from "@/types";

beforeEach(() => {
  h.mobile = false; vi.clearAllMocks(); useSessionConnectionStore.getState().cancel();
  useSessionStore.setState({ connect: h.connect, connectDirect: h.direct });
  useConnectionStore.setState({ connections: [{ id: "host", host: "example.test", port: 22, username: "alice" } as Connection], teamConnections: {} });
});
test("desktop saved SSH opens the chooser and repeated clicks do not create a tab or another request", () => {
  launchHost("host"); const token = useSessionConnectionStore.getState().pending[0].token;
  launchHost("host"); expect(useSessionConnectionStore.getState().pending[0].token).toBe(token);
  expect(h.connect).not.toHaveBeenCalled();
});
test("quick SSH has a stable unsaved target for desktop de-duplication; Android keeps its original direct launch", () => {
  const intent = { kind: "ssh" as const, user: "alice", host: "example.test", port: 22 };
  launchQuickConnect(intent); const request = useSessionConnectionStore.getState().pending[0]; expect(request.direct).toBe(true);
  useSessionConnectionStore.getState().cancel(); launchQuickConnect(intent);
  expect(useSessionConnectionStore.getState().pending[0].connection.id).toBe(request.connection.id);
  h.mobile = true; useSessionConnectionStore.getState().cancel(); launchHost("host"); launchQuickConnect(intent);
  expect(useSessionConnectionStore.getState().pending).toEqual([]); expect(h.connect).toHaveBeenCalledWith("host"); expect(h.direct).toHaveBeenCalledTimes(1);
});
