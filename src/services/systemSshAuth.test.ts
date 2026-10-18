// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({ platform: "linux" }));
vi.mock("@/utils/platform", () => ({ getPlatformSync: () => h.platform }));
import { normalizeSystemSshAuth, withSystemPassphrases } from "./systemSshAuth";
import { systemSshAuthFor, useSystemSshAuthStore } from "@/stores/systemSshAuthStore";
beforeEach(() => { h.platform = "linux"; localStorage.clear(); useSystemSshAuthStore.setState({ byConnection: {}, invalid: {} }); });

test("local policy strips secrets and transient ids before persistence and rejects pasted keys", () => {
  const raw = { mode: "keys", identityFiles: [" ~/.ssh/id_ed25519 ", "~/.ssh/id_ed25519"], useConfig: true, passphrase: "synthetic-secret", privateKey: "synthetic-private", credentialId: "transient" };
  const normalized = normalizeSystemSshAuth(raw)!; expect(normalized.identityFiles).toEqual(["~/.ssh/id_ed25519"]);
  useSystemSshAuthStore.getState().set("host", raw as typeof normalized);
  const persisted = localStorage.getItem("voltius-system-ssh-auth")!; expect(persisted).toContain("id_ed25519");
  for (const text of ["synthetic-secret", "synthetic-private", "transient", "passphrase", "privateKey"]) expect(persisted).not.toContain(text);
  expect(normalizeSystemSshAuth({ ...raw, identityFiles: ["-----BEGIN OPENSSH PRIVATE KEY-----"] })).toBeUndefined();
  expect(normalizeSystemSshAuth({ ...raw, identityFiles: ["a", "b", "c", "d"] })).toBeUndefined();
});

test("Android behavior stays independent; invalid edits cannot silently use an old identity", () => {
  useSystemSshAuthStore.getState().set("host", { mode: "keys", identityFiles: [], useConfig: false });
  expect(systemSshAuthFor("host")?.mode).toBe("keys"); h.platform = "android"; expect(systemSshAuthFor("host")).toBeUndefined();
  h.platform = "windows"; useSystemSshAuthStore.getState().setInvalid("host", true); expect(() => systemSshAuthFor("host")).toThrow(/paths are invalid/);
});

test("passphrase application preserves each hop's identity and never changes the original", () => {
  const original = { passphrase: "final-existing", systemAuth: { mode: "keys" as const, credentialId: "final", useConfig: false, identityFiles: [] }, jumpHosts: [{ systemAuth: { mode: "keys" as const, credentialId: "jump", identityFiles: [], useConfig: false } }] };
  const next = withSystemPassphrases(original, { jump: "synthetic-hop" }); expect(next.passphrase).toBe("final-existing");
  expect(next.jumpHosts[0]).toHaveProperty("passphrase", "synthetic-hop"); expect(original.jumpHosts[0]).not.toHaveProperty("passphrase");
});

test("version-zero preferences migrate old false and block removed agent choices without saving secrets", async () => {
  localStorage.setItem("voltius-system-ssh-auth", JSON.stringify({ version: 0, state: { byConnection: {
    oldKeys: { mode: "keys", identityFiles: ["~/.ssh/explicit"], useConfig: false },
    oldAgent: { mode: "agent", identityFiles: ["~/.ssh/agent.pub"], useConfig: false, passphrase: "synthetic-never-retained", privateKey: "synthetic-private" },
    invalidKeys: { mode: "keys", identityFiles: ["-----BEGIN PRIVATE KEY-----"] },
  } } }));
  await useSystemSshAuthStore.persist.rehydrate();
  expect(systemSshAuthFor("oldKeys")).toMatchObject({ mode: "keys", identityFiles: ["~/.ssh/explicit"], useConfig: true });
  expect(useSystemSshAuthStore.getState().byConnection.oldAgent).toEqual({ mode: "removed-agent" });
  expect(() => systemSshAuthFor("oldAgent")).toThrow(/agent login has been removed/);
  expect(useSystemSshAuthStore.getState().byConnection.invalidKeys).toEqual({ mode: "invalid" });
  expect(() => systemSshAuthFor("invalidKeys")).toThrow(/policy is invalid/);
  const persisted = localStorage.getItem("voltius-system-ssh-auth")!;
  for (const secret of ["synthetic-never-retained", "synthetic-private", "agent.pub", "PRIVATE KEY"]) expect(persisted).not.toContain(secret);
  useSystemSshAuthStore.getState().set("oldAgent", { mode: "keys", identityFiles: [], useConfig: true });
  expect(systemSshAuthFor("oldAgent")?.mode).toBe("keys");
});
