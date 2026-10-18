import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { SystemSshAuthFields } from "./SystemSshAuthFields";
import { useSystemSshAuthStore } from "@/stores/systemSshAuthStore";

beforeEach(() => useSystemSshAuthStore.setState({ byConnection: {}, invalid: {} }));
afterEach(cleanup);
test("system files automatically expose config alias without a config switch or agent login option", () => {
  render(<SystemSshAuthFields connectionId="synthetic" />);
  const mode = screen.getByLabelText("connections.systemAuth.label");
  expect(Array.from((mode as HTMLSelectElement).options).map((option) => option.value)).toEqual(["vault", "keys"]);
  fireEvent.change(mode, { target: { value: "keys" } });
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByLabelText("connections.systemAuth.alias")).toBeTruthy();
  expect(useSystemSshAuthStore.getState().byConnection.synthetic).toMatchObject({ mode: "keys", useConfig: true });
});
test("a removed agent preference requires an explicit replacement choice", () => {
  useSystemSshAuthStore.setState({ byConnection: { synthetic: { mode: "removed-agent" } } });
  render(<SystemSshAuthFields connectionId="synthetic" />);
  const mode = screen.getByLabelText("connections.systemAuth.label") as HTMLSelectElement;
  expect(mode.value).toBe("removed-agent"); expect(screen.getByRole("alert").textContent).toContain("agentRemoved");
  expect(screen.queryByLabelText("connections.systemAuth.paths")).toBeNull();
  fireEvent.change(mode, { target: { value: "vault" } });
  expect(useSystemSshAuthStore.getState().byConnection.synthetic).toBeUndefined();
  expect(screen.queryByRole("alert")).toBeNull();
});
