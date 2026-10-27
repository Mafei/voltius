import { expect, test, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/invoke", () => ({ invoke, Channel: class {} }));
import { sshSetOutputPaused } from "./ssh";
test("a late pause cannot land after its resume and permanently suppress PTY reads", async () => {
  let release!: () => void;
  let paused = false;
  invoke.mockImplementationOnce(async (_c, args) => {
    await new Promise<void>((r) => { release = r; }); paused = args.paused;
  }).mockImplementationOnce(async (_c, args) => { paused = args.paused; });
  const pause = sshSetOutputPaused("a", true), resume = sshSetOutputPaused("a", false);
  await Promise.resolve(); await Promise.resolve();
  release(); await Promise.all([pause, resume]); expect(paused).toBe(false);
});
