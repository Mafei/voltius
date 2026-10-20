/** Paths and policy only. Private keys are read inside the desktop SSH backend. */
export interface SystemSshAuth {
  mode: "keys";
  identityFiles: string[];
  useConfig: boolean;
  configHost?: string;
  identitiesOnly?: boolean;
  /** Transient routing for an encrypted-key challenge; excluded from saved preferences. */
  credentialId?: string;
}
export type SavedSystemSshAuth = SystemSshAuth | { mode: "removed-agent" | "invalid" };

/** Preserve a blocking marker; an old agent choice must never silently become another identity. */
export function normalizeSavedSystemSshAuth(value: unknown): SavedSystemSshAuth | undefined {
  if (value === undefined) return;
  if (value && typeof value === "object" && ["agent", "removed-agent"].includes(String((value as { mode?: unknown }).mode))) return { mode: "removed-agent" };
  return normalizeSystemSshAuth(value) ?? { mode: "invalid" };
}

export interface SystemAuthEnvelope { systemAuth?: SystemSshAuth; passphrase?: string; jumpHosts?: SystemAuthEnvelope[] | null; target?: SystemAuthEnvelope }

export function ownsSystemAuthTarget(params: SystemAuthEnvelope, id: string): boolean {
  return params.systemAuth?.credentialId === id || !!params.jumpHosts?.some((hop) => ownsSystemAuthTarget(hop, id)) || !!(params.target && ownsSystemAuthTarget(params.target, id));
}

/** Apply an in-memory answer to the correct hop only. Never persist or log this object. */
export function withSystemPassphrases<T extends SystemAuthEnvelope>(params: T, answers: Record<string, string>): T {
  const id = params.systemAuth?.credentialId;
  return { ...params, ...(id && answers[id] !== undefined && { passphrase: answers[id] }),
    ...(params.target && { target: withSystemPassphrases(params.target, answers) }),
    ...(params.jumpHosts && { jumpHosts: params.jumpHosts.map((hop) => withSystemPassphrases(hop, answers)) }) };
}

export function normalizeSystemSshAuth(value: unknown): SystemSshAuth | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (v.mode !== "keys") return;
  const paths = Array.isArray(v.identityFiles) ? v.identityFiles.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean) : [];
  if (paths.length > 3 || paths.some((p) => p.length > 4096 || /[\r\n\0]|PRIVATE KEY/.test(p))) return;
  return {
    // Config lookup is automatic. Migrate old false/omitted values as well.
    mode: "keys", identityFiles: [...new Set(paths)], useConfig: true,
    ...(typeof v.configHost === "string" && { configHost: v.configHost.slice(0, 1024) }),
    ...(typeof v.identitiesOnly === "boolean" && { identitiesOnly: v.identitiesOnly }),
  };
}
