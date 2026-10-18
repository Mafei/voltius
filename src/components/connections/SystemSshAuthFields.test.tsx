import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { SystemSshAuthFields } from "./SystemSshAuthFields";
import { systemSshAuthFor, useSystemSshAuthStore } from "@/stores/systemSshAuthStore";

beforeEach(() => useSystemSshAuthStore.setState({ byConnection: {}, invalid: {} }));
afterEach(cleanup);
test("late device preferences and a different host show exactly the paths used by credential resolution", () => {
  const view = render(<SystemSshAuthFields connectionId="synthetic" />);
  act(() => useSystemSshAuthStore.getState().set("synthetic", { mode: "keys", identityFiles: ["~/.ssh/synthetic-custom"], useConfig: false }));
  expect((screen.getByLabelText("connections.systemAuth.paths") as HTMLTextAreaElement).value).toBe("~/.ssh/synthetic-custom");
  expect(systemSshAuthFor("synthetic")?.identityFiles).toEqual(["~/.ssh/synthetic-custom"]);
  act(() => useSystemSshAuthStore.getState().set("other", { mode: "keys", identityFiles: ["~/.ssh/other-synthetic"], useConfig: true }));
  view.rerender(<SystemSshAuthFields connectionId="other" />);
  expect((screen.getByLabelText("connections.systemAuth.paths") as HTMLTextAreaElement).value).toBe("~/.ssh/other-synthetic");
});
test("changing a config alias cannot unblock an invalid path draft and silently use the previous identity", () => {
  useSystemSshAuthStore.getState().set("synthetic", { mode: "keys", identityFiles: ["~/.ssh/previous-synthetic"], useConfig: true });
  render(<SystemSshAuthFields connectionId="synthetic" />);
  fireEvent.change(screen.getByLabelText("connections.systemAuth.paths"), { target: { value: "a\nb\nc\nd" } });
  expect(() => systemSshAuthFor("synthetic")).toThrow(/paths are invalid/);
  fireEvent.change(screen.getByLabelText("connections.systemAuth.alias"), { target: { value: "synthetic-alias" } });
  expect(() => systemSshAuthFor("synthetic")).toThrow(/paths are invalid/);
});
test("closing one editor cannot clear another editor's invalid identity draft", () => {
  useSystemSshAuthStore.getState().set("synthetic", { mode: "keys", identityFiles: [], useConfig: true });
  const first = render(<SystemSshAuthFields connectionId="synthetic" />);
  const second = render(<SystemSshAuthFields connectionId="synthetic" />);
  for (const input of screen.getAllByLabelText("connections.systemAuth.paths")) fireEvent.change(input, { target: { value: "a\nb\nc\nd" } });
  first.unmount(); expect(() => systemSshAuthFor("synthetic")).toThrow(/paths are invalid/);
  second.unmount(); expect(systemSshAuthFor("synthetic")?.mode).toBe("keys");
});
test("system files automatically expose config alias without a config switch or agent login option", () => {
  render(<SystemSshAuthFields connectionId="synthetic" />);
  const mode = screen.getByLabelText("connections.systemAuth.label");
  expect(Array.from((mode as HTMLSelectElement).options).map((option) => option.value)).toEqual(["vault", "keys"]);
  fireEvent.change(mode, { target: { value: "keys" } });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByLabelText("connections.systemAuth.alias")).toBeTruthy();
  expect(useSystemSshAuthStore.getState().byConnection.synthetic).toMatchObject({ mode: "keys", useConfig: true });
});
test.each(["removed-agent", "invalid"] as const)("a blocked %s preference requires an explicit replacement choice", (blocked) => {
  useSystemSshAuthStore.setState({ byConnection: { synthetic: { mode: blocked } } });
  render(<SystemSshAuthFields connectionId="synthetic" />);
  const mode = screen.getByLabelText("connections.systemAuth.label") as HTMLSelectElement;
  expect(mode.value).toBe(blocked); expect(screen.getByRole("alert").textContent).toContain(blocked === "removed-agent" ? "agentRemoved" : "policyInvalid");
  expect(screen.queryByLabelText("connections.systemAuth.paths")).toBeNull();
  fireEvent.change(mode, { target: { value: "vault" } });
  expect(useSystemSshAuthStore.getState().byConnection.synthetic).toBeUndefined();
  expect(screen.queryByRole("alert")).toBeNull();
});
