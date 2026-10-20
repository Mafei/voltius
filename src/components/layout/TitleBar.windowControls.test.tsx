import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TitleBar from "./TitleBar";

const native = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  startDragging: vi.fn(),
}));
const platform = vi.hoisted(() => ({ os: null as string | null }));
vi.mock("@/utils/platform", () => ({ usePlatform: () => platform.os }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({ getConnectionIcon: () => null, getConnectionIconColor: () => null }));

beforeEach(() => {
  platform.os = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

it("removes web window controls only after macOS is confirmed", () => {
  const { rerender } = render(<TitleBar />);
  expect(screen.getByTitle("layout.titleBar.close")).toBeTruthy();
  platform.os = "macos";
  rerender(<TitleBar />);
  for (const action of ["close", "minimize", "maximize"]) {
    expect(screen.queryByTitle(`layout.titleBar.${action}`)).toBeNull();
  }
  // The application tab/navigation row remains in the content area.
  expect(screen.getByText("common.entity.vaults")).toBeTruthy();
});

it.each(["linux", "windows", "android", "ios", "unknown", null])(
  "preserves existing web window actions and drag handling on %s",
  (os) => {
    platform.os = os;
    const { container } = render(<TitleBar />);
    for (const [action, handler] of [
      ["close", native.close],
      ["minimize", native.minimize],
      ["maximize", native.toggleMaximize],
    ] as const) {
      const button = screen.getByTitle(`layout.titleBar.${action}`);
      fireEvent.mouseDown(button, { button: 0 });
      fireEvent.click(button);
      expect(handler).toHaveBeenCalledOnce();
    }
    expect(native.startDragging).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.firstElementChild!, { button: 0 });
    expect(native.startDragging).toHaveBeenCalledOnce();
    fireEvent.mouseDown(container.firstElementChild!, { button: 1 });
    expect(native.startDragging).toHaveBeenCalledOnce();
  },
);
