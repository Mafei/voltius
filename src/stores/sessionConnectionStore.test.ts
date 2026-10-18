import { beforeEach, expect, test, vi } from "vitest";
import { useSessionConnectionStore as store } from "./sessionConnectionStore";
import type { Connection } from "@/types";

const host = (id: string) => ({ id, host: `${id}.example.test`, port: 22, username: "alice" }) as Connection;
beforeEach(() => store.getState().cancel());

test("one host request is reused; stale cancellation and duplicate completion cannot close the next host", () => {
  const done = vi.fn(); store.getState().request([host("a"), host("b")], done);
  const first = store.getState().pending[0].token;
  store.getState().finish(first, "tab-a"); const second = store.getState().pending[0].token;
  store.getState().finish(first, "duplicate"); store.getState().cancel(first);
  expect(store.getState().pending[0].token).toBe(second);
  expect(done).not.toHaveBeenCalled(); store.getState().finish(second, "tab-b");
  expect(done).toHaveBeenCalledExactlyOnceWith(["tab-a", "tab-b"]); expect(store.getState().pending).toEqual([]);
});

test("repeat clicks share a request; a different host replaces it and old callbacks are ignored", () => {
  const old = vi.fn(), fresh = vi.fn(); store.getState().request([host("a")], old);
  const first = store.getState().pending[0].token; store.getState().request([host("a")], fresh);
  expect(store.getState().pending[0].token).toBe(first);
  store.getState().request([host("b")], fresh); const next = store.getState().pending[0].token;
  store.getState().cancel(first); store.getState().finish(first, "old-tab");
  expect(store.getState().pending[0].token).toBe(next); expect(old).not.toHaveBeenCalled();
  store.getState().cancel(next); expect(store.getState().pending).toEqual([]); expect(fresh).not.toHaveBeenCalled();
});
