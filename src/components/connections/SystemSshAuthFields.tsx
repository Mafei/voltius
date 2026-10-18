import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSystemSshAuthStore } from "@/stores/systemSshAuthStore";
import { normalizeSavedSystemSshAuth, normalizeSystemSshAuth, type SystemSshAuth } from "@/services/systemSshAuth";

/** Device-local policy editor shared by host editing and the session chooser. */
export function SystemSshAuthFields({ connectionId, disabled, onChange }: {
  connectionId: string; disabled?: boolean; onChange?: () => void;
}) {
  const { t } = useTranslation(); const id = useId();
  const preference = normalizeSavedSystemSshAuth(useSystemSshAuthStore((s) => s.byConnection[connectionId]));
  const blocked = preference && preference.mode !== "keys" ? preference.mode : undefined;
  const warning = blocked === "removed-agent" ? "connections.systemAuth.agentRemoved" : "connections.systemAuth.policyInvalid";
  const saved = preference?.mode === "keys" ? preference : undefined;
  const canonicalPaths = saved?.identityFiles.join("\n") ?? "";
  const scope = JSON.stringify([connectionId, preference?.mode, canonicalPaths]);
  const [draft, setDraft] = useState<{ scope: string; text: string; invalid: boolean } | null>(null);
  const currentDraft = draft?.scope === scope ? draft : null;
  const paths = currentDraft?.text ?? canonicalPaths;
  const invalid = currentDraft?.invalid ?? false;
  useEffect(() => {
    if (draft && draft.scope !== scope) setDraft(null);
    useSystemSshAuthStore.getState().setInvalid(connectionId, invalid, id);
  }, [connectionId, id, scope, invalid, draft]);
  useEffect(() => () => useSystemSshAuthStore.getState().setInvalid(connectionId, false, id), [connectionId, id]);
  const update = (value: SystemSshAuth | undefined, resetDraft = false) => {
    if (resetDraft) { setDraft(null); useSystemSshAuthStore.getState().setInvalid(connectionId, false, id); }
    useSystemSshAuthStore.getState().set(connectionId, value); onChange?.();
  };
  return <fieldset disabled={disabled} className="my-3 space-y-2 text-sm">
    <label htmlFor={`${id}-mode`} className="block">{t("connections.systemAuth.label")}</label>
    <select id={`${id}-mode`} value={blocked ?? saved?.mode ?? "vault"} className="w-full rounded-lg border p-2 bg-(--t-bg-card) border-(--t-border)"
      onChange={(event) => { const mode = event.target.value;
        update(mode === "keys" ? { mode, identityFiles: [], useConfig: true } : undefined, true); }}>
      <option value="vault">{t("connections.systemAuth.vault")}</option>
      <option value="keys">{t("connections.systemAuth.keys")}</option>
      {blocked && <option value={blocked} disabled>{t(warning)}</option>}
    </select>
    {blocked && <p role="alert">{t(warning)}</p>}
    {saved && <>
      <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.localHint")}</p>
      <label htmlFor={`${id}-paths`} className="block">{t("connections.systemAuth.paths")}</label>
      <textarea id={`${id}-paths`} rows={2} value={paths} spellCheck={false} autoComplete="off" aria-invalid={invalid}
        placeholder={t("connections.systemAuth.pathsPlaceholder")} className="w-full rounded-lg border p-2 bg-(--t-bg-card) border-(--t-border)"
        onChange={(event) => {
          const value = event.target.value;
          const next = normalizeSystemSshAuth({ ...saved, identityFiles: value.split("\n") });
          setDraft({ scope: JSON.stringify([connectionId, preference?.mode, next?.identityFiles.join("\n") ?? canonicalPaths]), text: value, invalid: !next });
          useSystemSshAuthStore.getState().setInvalid(connectionId, !next, id);
          if (next) update(next); else onChange?.();
        }} />
      {invalid && <p role="alert">{t("connections.systemAuth.pathError")}</p>}
      <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.pathHint")}</p>
      <label htmlFor={`${id}-alias`} className="block">{t("connections.systemAuth.alias")}</label>
      <input id={`${id}-alias`} value={saved.configHost ?? ""} autoComplete="off" spellCheck={false} className="w-full rounded-lg border p-2 bg-(--t-bg-card) border-(--t-border)"
        onChange={(event) => update({ ...saved, configHost: event.target.value })} />
      <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.configHint")}</p>
      <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.attemptsHint")}</p>
    </>}
  </fieldset>;
}
