/** Paths and policy only. Private keys are read inside the desktop SSH backend. */
export interface SystemSshAuth {
  mode: "keys" | "agent";
  identityFiles: string[];
  useConfig: boolean;
  configHost?: string;
  identitiesOnly?: boolean;
  /** Transient routing for an encrypted-key challenge; excluded from saved preferences. */
  credentialId?: string;
}

export interface SystemAuthEnvelope { systemAuth?: SystemSshAuth; passphrase?: string; jumpHosts?: SystemAuthEnvelope[] | null }

/** Apply an in-memory answer to the correct hop only. Never persist or log this object. */
export function withSystemPassphrases<T extends SystemAuthEnvelope>(params: T, answers: Record<string, string>): T {
  const id = params.systemAuth?.credentialId;
  return { ...params, ...(id && answers[id] !== undefined && { passphrase: answers[id] }),
    ...(params.jumpHosts && { jumpHosts: params.jumpHosts.map((hop) => withSystemPassphrases(hop, answers)) }) };
}

export function normalizeSystemSshAuth(value: unknown): SystemSshAuth | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (v.mode !== "keys" && v.mode !== "agent") return;
  const paths = Array.isArray(v.identityFiles) ? v.identityFiles.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean) : [];
  if (paths.length > 3 || paths.some((p) => p.length > 4096 || /[\r\n\0]|PRIVATE KEY/.test(p))) return;
  return {
    mode: v.mode, identityFiles: [...new Set(paths)], useConfig: v.useConfig === true,
    ...(typeof v.configHost === "string" && { configHost: v.configHost.slice(0, 1024) }),
    ...(typeof v.identitiesOnly === "boolean" && { identitiesOnly: v.identitiesOnly }),
  };
}
