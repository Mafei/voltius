import { beforeEach, expect, test, vi } from "vitest";
import { BackendError } from "./backendErrors";
const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
import { answerSystemSshUnlock, cancelSystemSshUnlocks, systemSshInvoke, useSystemSshUnlockStore } from "./systemSshUnlock";

const challenge = (id = "jump") => new BackendError("ssh-key-passphrase", "Encrypted system key needs a passphrase", { authConnectionId: id });
const params = () => ({ systemAuth: { mode: "keys", credentialId: "final", identityFiles: [], useConfig: false }, jumpHosts: [{ host: "synthetic", systemAuth: { mode: "keys", credentialId: "jump", identityFiles: [], useConfig: false } }] });
beforeEach(() => { cancelSystemSshUnlocks(); h.invoke.mockReset(); });

test.each(["sftp_connect", "ssh_exec_command", "ssh_kill_persistent"])("%s answers only the challenged hop in memory and leaves original args unchanged", async (command) => {
  const original = params(); h.invoke.mockRejectedValueOnce(challenge()).mockResolvedValueOnce("connected");
  const result = systemSshInvoke(command, original); await vi.waitFor(() => expect(useSystemSshUnlockStore.getState().pending).toHaveLength(1));
  const request = useSystemSshUnlockStore.getState().pending[0]; expect(request.connectionId).toBe("jump");
  answerSystemSshUnlock(request.token, "synthetic-only"); await expect(result).resolves.toBe("connected");
  expect(h.invoke.mock.calls[1][1].jumpHosts[0].passphrase).toBe("synthetic-only");
  expect(h.invoke.mock.calls[1][1].passphrase).toBeUndefined(); expect(JSON.stringify(original)).not.toContain("synthetic-only");
  expect(useSystemSshUnlockStore.getState().pending).toEqual([]);
});

test("cancellation sends no retry and late/double answers cannot resurrect it", async () => {
  h.invoke.mockRejectedValue(challenge()); const result = systemSshInvoke("sftp_connect", params()); const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(useSystemSshUnlockStore.getState().pending).toHaveLength(1)); const token = useSystemSshUnlockStore.getState().pending[0].token;
  answerSystemSshUnlock(token, null); answerSystemSshUnlock(token, "late-synthetic"); await rejection;
  expect(h.invoke).toHaveBeenCalledTimes(1); expect(useSystemSshUnlockStore.getState().pending).toEqual([]);
});

test("agent failure and an unknown challenge target never trigger a key prompt", async () => {
  for (const error of [new Error("SYSTEM_SSH_AGENT_UNAVAILABLE"), challenge("unowned")]) {
    h.invoke.mockRejectedValueOnce(error); await expect(systemSshInvoke("sftp_connect", params())).rejects.toBe(error);
    expect(useSystemSshUnlockStore.getState().pending).toEqual([]);
  }
});

test("a picker uses its inline prompt; repeated wrong answers have a finite retry bound", async () => {
  h.invoke.mockRejectedValue(challenge("final")); await expect(systemSshInvoke("ssh_connect", params(), false)).rejects.toHaveProperty("code", "ssh-key-passphrase");
  expect(useSystemSshUnlockStore.getState().pending).toEqual([]); h.invoke.mockClear();
  const result = systemSshInvoke("sftp_connect", params()); const rejection = expect(result).rejects.toHaveProperty("code", "ssh-key-passphrase");
  for (let i = 0; i < 3; i++) { await vi.waitFor(() => expect(useSystemSshUnlockStore.getState().pending).toHaveLength(1)); answerSystemSshUnlock(useSystemSshUnlockStore.getState().pending[0].token, "synthetic-wrong"); }
  await rejection; expect(h.invoke).toHaveBeenCalledTimes(4); expect(useSystemSshUnlockStore.getState().pending).toEqual([]);
});
