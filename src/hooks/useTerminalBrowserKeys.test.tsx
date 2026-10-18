// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
const h = vi.hoisted(() => ({ invoke: vi.fn(), platform: "windows" }));
vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/utils/platform", () => ({ getPlatform: async () => h.platform }));
import { useTerminalBrowserKeys } from "./useTerminalBrowserKeys";

beforeEach(() => { h.invoke.mockReset().mockResolvedValue(undefined); h.platform = "windows"; vi.spyOn(document, "hasFocus").mockReturnValue(true); });
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

test("WebView2 focus changes serialize and converge on the latest focused element", async () => {
  const host = document.createElement("div"); host.className = "xterm"; const terminal = document.createElement("textarea"); host.append(terminal);
  const input = document.createElement("input"); document.body.append(host, input); input.focus();
  const { unmount } = renderHook(() => useTerminalBrowserKeys());
  await waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith("terminal_browser_keys", { terminalFocused: false }));
  let release!: () => void;
  h.invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  terminal.focus(); await waitFor(() => expect(h.invoke).toHaveBeenLastCalledWith("terminal_browser_keys", { terminalFocused: true }));
  input.focus(); await Promise.resolve(); terminal.focus(); await Promise.resolve();
  expect(h.invoke).toHaveBeenCalledTimes(2); release(); await Promise.resolve(); await Promise.resolve();
  input.focus(); await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(3));
  expect(h.invoke).toHaveBeenLastCalledWith("terminal_browser_keys", { terminalFocused: false });
  unmount();
});

test("other platforms do not send a native browser accelerator command", async () => {
  h.platform = "linux"; renderHook(() => useTerminalBrowserKeys()); await Promise.resolve(); await Promise.resolve();
  expect(h.invoke).not.toHaveBeenCalled();
});
