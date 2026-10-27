import { expect, test } from "vitest";
import { TerminalTrace } from "./terminalTrace";
test("runtime schema excludes identifiers, content, strings, arbitrary errors and nested payloads", () => {
  const t = new TerminalTrace();
  t.record("alice@private.example", "input_received", { bytes: 12, password: "secret", error: "token", nested: { text: "secret" } } as never);
  t.record(null, "secret-command" as never, {});
  const json = JSON.stringify(t.snapshot());
  for (const value of ["alice", "private", "secret", "password", "token", "nested"]) expect(json).not.toContain(value);
  expect(t.snapshot()).toHaveLength(1);
});
test("bounded recent window expires, hot output coalesces, and markers fence aggregation", () => {
  let now = 1000;
  const t = new TerminalTrace(4, 100, () => now);
  for (let i = 0; i < 10000; i++) t.record("a", "output_write", { bytes: 2, seq: i });
  expect(t.snapshot()).toHaveLength(1); expect(t.snapshot()[0].values.bytes).toBe(20000);
  t.record("a", "marker_render"); t.record("a", "output_write", { bytes: 3 });
  expect(t.snapshot()).toHaveLength(3);
  for (let i = 0; i < 100; i++) t.record("b", "focus", { focused: !!(i % 2) });
  expect(t.snapshot()).toHaveLength(4);
  now += 101; t.prune(); expect(t.snapshot()).toEqual([]); expect(t.sessionIds()).toEqual([]);
});
test("snapshots cannot mutate retained diagnostics and session identity memory is bounded", () => {
  const t = new TerminalTrace();
  for (let i = 0; i < 1000; i++) t.record(`private-${i}`, "focus", { focused: true });
  expect(t.sessionIds().length).toBeLessThanOrEqual(128);
  const snapshot = t.snapshot(); snapshot[0].values.focused = false;
  expect(t.snapshot()[0].values.focused).toBe(true);
});
