import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSystemSshAuthStore } from "@/stores/systemSshAuthStore";
import { normalizeSystemSshAuth, type SystemSshAuth } from "@/services/systemSshAuth";

/** Device-local policy editor shared by host editing and the session chooser. */
export function SystemSshAuthFields({ connectionId, disabled, onChange }: {
  connectionId: string; disabled?: boolean; onChange?: () => void;
}) {
  const { t } = useTranslation(); const id = useId();
  const saved = useSystemSshAuthStore((s) => s.byConnection[connectionId]);
  const [paths, setPaths] = useState(() => saved?.identityFiles.join("\n") ?? "");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => () => useSystemSshAuthStore.getState().setInvalid(connectionId, false), [connectionId]);
  const update = (value: SystemSshAuth | undefined) => {
    useSystemSshAuthStore.getState().setInvalid(connectionId, false);
    useSystemSshAuthStore.getState().set(connectionId, value); onChange?.();
  };
  return <fieldset disabled={disabled} className="my-3 space-y-2 text-sm">
    <label htmlFor={`${id}-mode`} className="block">{t("connections.systemAuth.label")}</label>
    <select id={`${id}-mode`} value={saved?.mode ?? "vault"} className="w-full rounded-lg border p-2 bg-(--t-bg-card) border-(--t-border)"
      onChange={(event) => { const mode = event.target.value; setInvalid(false); setPaths("");
        update(mode === "keys" || mode === "agent" ? { mode, identityFiles: [], useConfig: true } : undefined); }}>
      <option value="vault">{t("connections.systemAuth.vault")}</option>
      <option value="keys">{t("connections.systemAuth.keys")}</option>
      <option value="agent">{t("connections.systemAuth.agent")}</option>
    </select>
    {saved && <>
      <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.localHint")}</p>
      <label htmlFor={`${id}-paths`} className="block">{t("connections.systemAuth.paths")}</label>
      <textarea id={`${id}-paths`} rows={2} value={paths} spellCheck={false} autoComplete="off" aria-invalid={invalid}
        placeholder="~/.ssh/id_ed25519" className="w-full rounded-lg border p-2 bg-(--t-bg-card) border-(--t-border)"
        onChange={(event) => {
          const value = event.target.value; setPaths(value);
          const next = normalizeSystemSshAuth({ ...saved, identityFiles: value.split("\n") });
          setInvalid(!next); if (next) update(next);
          else { useSystemSshAuthStore.getState().setInvalid(connectionId, true); onChange?.(); }
        }} />
      {invalid && <p role="alert">{t("connections.systemAuth.pathError")}</p>}
      <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.pathHint")}</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={saved.useConfig}
        onChange={(event) => update({ ...saved, useConfig: event.target.checked })} />{t("connections.systemAuth.config")}</label>
      {saved.useConfig && <>
        <label htmlFor={`${id}-alias`} className="block">{t("connections.systemAuth.alias")}</label>
        <input id={`${id}-alias`} value={saved.configHost ?? ""} autoComplete="off" spellCheck={false} className="w-full rounded-lg border p-2 bg-(--t-bg-card) border-(--t-border)"
          onChange={(event) => update({ ...saved, configHost: event.target.value })} />
        <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.configHint")}</p>
      </>}
      {saved.mode === "agent" && <>
        <label htmlFor={`${id}-identities`} className="block">{t("connections.systemAuth.identitiesOnly")}</label>
        <select id={`${id}-identities`} value={saved.identitiesOnly === undefined ? "config" : saved.identitiesOnly ? "yes" : "no"}
          className="w-full rounded-lg border p-2 bg-(--t-bg-card) border-(--t-border)"
          onChange={(event) => update({ ...saved, identitiesOnly: event.target.value === "config" ? undefined : event.target.value === "yes" })}>
          <option value="config">{t("connections.systemAuth.identitiesDefault")}</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      </>}
      <p className="text-xs text-(--t-text-dim)">{t("connections.systemAuth.agentHint")}</p>
    </>}
  </fieldset>;
}
