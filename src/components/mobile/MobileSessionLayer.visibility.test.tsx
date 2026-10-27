import { expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
const state = vi.hoisted(() => ({ activeSessionId: "a", sessions: [{ id: "a", type: "ssh", status: "connected" }, { id: "b", type: "ssh", status: "connected" }] }));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("./MobileSessionView", () => ({ default: ({ session, active, visible }: { session: { id: string }; active: boolean; visible: boolean }) =>
  <div data-testid={session.id} data-active={active} data-visible={visible} /> }));
import MobileSessionLayer from "./MobileSessionLayer";
test("hosts/terminal navigation and tab switches preserve views while suppressing hidden fits", () => {
  const view = render(<MobileSessionLayer visible />);
  const a = view.getByTestId("a"), b = view.getByTestId("b");
  expect(a.dataset.visible).toBe("true"); expect(b.dataset.visible).toBe("false");
  view.rerender(<MobileSessionLayer visible={false} />);
  expect(a.dataset.visible).toBe("false"); expect(a.dataset.active).toBe("false");
  view.rerender(<MobileSessionLayer visible />);
  expect(view.getByTestId("a")).toBe(a); expect(a.dataset.visible).toBe("true");
  state.activeSessionId = "b"; view.rerender(<MobileSessionLayer visible />);
  expect(a.dataset.visible).toBe("false"); expect(b.dataset.visible).toBe("true");
});
