import { create } from "zustand";
import { invoke } from "@/lib/invoke";
import { BackendError } from "./backendErrors";
import { ownsSystemAuthTarget, withSystemPassphrases, type SystemAuthEnvelope } from "./systemSshAuth";

type Challenge = { token: string; connectionId: string; answer: (passphrase: string | null) => void };
export const useSystemSshUnlockStore = create<{ pending: Challenge[] }>(() => ({ pending: [] }));

export function answerSystemSshUnlock(token: string, passphrase: string | null): void {
  const pending = useSystemSshUnlockStore.getState().pending;
  const challenge = pending.find((entry) => entry.token === token); if (!challenge) return;
  useSystemSshUnlockStore.setState({ pending: pending.filter((entry) => entry !== challenge) });
  challenge.answer(passphrase);
}

export function cancelSystemSshUnlocks(): void {
  for (const entry of useSystemSshUnlockStore.getState().pending) answerSystemSshUnlock(entry.token, null);
}

function requestUnlock(connectionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const challenge: Challenge = { token: crypto.randomUUID(), connectionId, answer: (value) => {
      if (value === null) reject(new DOMException("System SSH authentication cancelled", "AbortError")); else resolve(value);
    } };
    useSystemSshUnlockStore.setState((s) => ({ pending: [...s.pending, challenge] }));
  });
}

export function systemSshPassphraseTarget(error: unknown): string | undefined {
  return error instanceof BackendError && error.code === "ssh-key-passphrase" ? error.params.authConnectionId || undefined : undefined;
}

/** Standalone SFTP/exec have no terminal overlay; prompt locally and retry the same verified SSH path. */
export async function systemSshInvoke<T>(command: string, initial: Record<string, unknown>, prompt = true): Promise<T> {
  let args = initial;
  for (let round = 0; ; round++) {
    try { return await invoke<T>(command, args); }
    catch (error) {
      const id = systemSshPassphraseTarget(error);
      const envelope = args as SystemAuthEnvelope;
      if (!prompt || !id || !ownsSystemAuthTarget(envelope, id) || round >= 3) throw error;
      const passphrase = await requestUnlock(id);
      args = withSystemPassphrases(envelope, { [id]: passphrase }) as Record<string, unknown>;
    }
  }
}
