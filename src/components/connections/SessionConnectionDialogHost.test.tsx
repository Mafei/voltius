// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "@/types";
import { useSessionConnectionStore } from "@/stores/sessionConnectionStore";
vi.mock("./SessionConnectionForm", () => ({ default: ({ onOpened, onClose }: { onOpened: (id: string) => void; onClose: () => void }) => <><button onClick={() => onOpened("opened")}>fixture finish</button><button onClick={onClose}>fixture cancel</button></> }));
import { SessionConnectionDialogHost } from "./SessionConnectionDialogHost";
afterEach(() => { cleanup(); useSessionConnectionStore.getState().cancel(); });
test("StrictMode replay keeps the pending request; final unmount cancels without invoking completion", async () => {
  const complete = vi.fn(); useSessionConnectionStore.getState().request([{ id: "synthetic" } as Connection], complete);
  const view = render(<StrictMode><SessionConnectionDialogHost /></StrictMode>); await Promise.resolve();
  expect(useSessionConnectionStore.getState().pending).toHaveLength(1); view.unmount(); await Promise.resolve();
  expect(useSessionConnectionStore.getState().pending).toEqual([]); expect(complete).not.toHaveBeenCalled();
});
test("finishing one queued host advances once and completes only after the final host", () => {
  const complete = vi.fn(); useSessionConnectionStore.getState().request([{ id: "one" }, { id: "two" }] as Connection[], complete);
  render(<SessionConnectionDialogHost />); fireEvent.click(screen.getByText("fixture finish")); expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("fixture finish")); expect(complete).toHaveBeenCalledExactlyOnceWith(["opened", "opened"]);
});
