import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/types";
import { createSessionPicker, type SessionPicker } from "@/services/tmuxPicker";
import type { RemoteSession, SessionListing, SessionType } from "@/services/ssh";
import { sameRemoteSession } from "@/services/tmuxSessionCore";
import { sessionTypeForHost, useSshSessionTypeStore } from "@/stores/sshSessionTypeStore";
import { describeError } from "@/services/backendErrors";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import BottomSheet from "@/components/mobile/sheets/BottomSheet";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useHostKeyConflict } from "@/components/terminal/connection-overlay/hooks";
import { HostKeyConflictPanel } from "@/components/terminal/connection-overlay/HostKeyConflictPanel";
import { SystemSshAuthFields } from "./SystemSshAuthFields";
import { systemSshPassphraseTarget } from "@/services/systemSshUnlock";

type Selection = { kind: "new" } | { kind: "existing"; remote: RemoteSession } | null;
const NEW_VALUE = "create-new";

export default function SessionConnectionForm({ connection, onClose, onOpened, presentation = "sheet", direct = false }: {
  connection: Connection; onClose: () => void; onOpened: (sessionId: string) => void;
  presentation?: "sheet" | "dialog"; direct?: boolean;
}) {
  const { t } = useTranslation();
  const translate = useRef(t); translate.current = t;
  const [type, setType] = useState<SessionType>(() => sessionTypeForHost(connection.id));
  const backend = type === "none" ? null : type;
  const [preparedId, setPreparedId] = useState(() => crypto.randomUUID());
  const [listing, setListing] = useState<SessionListing | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [authKind, setAuthKind] = useState<"password" | "passphrase" | null>(null);
  const [authText, setAuthText] = useState("");
  const [auth, setAuth] = useState<{ password?: string; passphrase?: string; systemPassphrases?: Record<string, string> } | undefined>();
  const [authTarget, setAuthTarget] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(backend !== null);
  const [busy, setBusy] = useState(false);
  const [authEdited, setAuthEdited] = useState(false);
  const composing = useRef(false);
  const pickerRef = useRef<SessionPicker | null>(null);
  const alive = useRef(true), busyRef = useRef(false), epoch = useRef(0);
  const dismissed = useRef(false);
  const preserve = useRef<{ selection: Selection; name: string } | null>(null);
  const { conflict, resolving, resolveConflict, listening } = useHostKeyConflict({
    sessionId: preparedId, status: error ? "error" : ready ? "connected" : "connecting",
    conflictEventName: `ssh-host-key-conflict-${preparedId}`,
  });

  function describeSessionError(reason: unknown): string {
    const message = describeError(reason, translate.current);
    if (/duplicate session|DUPLICATE_SESSION_NAME/.test(message)) return translate.current("mobile.session.duplicate");
    if (/SESSION_PICKER_|SESSION_CHANGED|SESSION_ENDED_OR_CHANGED/.test(message)) return translate.current("mobile.session.changed");
    if (/ZELLIJ_SESSION_NOT_RUNNING/.test(message)) return translate.current("mobile.session.notRunning");
    if (/UNSUPPORTED_VERSION/.test(message)) return translate.current("mobile.session.unsupportedVersion", { version: message.split(":").slice(1).join(":").trim() });
    if (/ZELLIJ_REQUIRES_LINUX|ZELLIJ_SOCKET_BIND_FAILED/.test(message)) return translate.current("mobile.session.zellijPlatform");
    if (/INVALID_NAME/.test(message)) return translate.current("mobile.session.invalidName");
    if (/COMMAND_TIMEOUT|START_NOT_CONFIRMED|START_FAILED/.test(message)) return translate.current("mobile.session.timeout");
    return message.replace(/^(?:TMUX|ZELLIJ|SESSION)_(?:LIST|CHOICE|VERSION)_FAILED:\s*/, "");
  }

  useEffect(() => {
    if (!listening || dismissed.current || authEdited) return;
    alive.current = true;
    const generation = epoch.current;
    const picker = direct || auth ? createSessionPicker(connection, backend, preparedId, { direct, auth })
      : createSessionPicker(connection, backend, preparedId);
    pickerRef.current = picker;
    let current = true;
    void picker.ready.then((value) => {
      if (!current || !alive.current || generation !== epoch.current) return;
      setListing(value); setLoading(false); setReady(true);
      const previous = preserve.current; preserve.current = null;
      if (previous?.selection?.kind === "existing") {
        const old = previous.selection.remote;
        const remote = value?.sessions.find((s) => sameRemoteSession(s, old));
        setSelection(remote ? { kind: "existing", remote } : null);
        if (!remote) { setName(""); setError(translate.current("mobile.session.changed")); }
      } else if (previous?.selection?.kind === "new") {
        setSelection({ kind: "new" }); setName(previous.name);
      }
    }, (reason) => {
      if (current && alive.current && generation === epoch.current) {
        setLoading(false); setReady(false); setError(describeSessionError(reason));
        const raw = reason instanceof Error ? reason.message : JSON.stringify(reason) ?? String(reason);
        if (/encrypted|invalid passphrase/i.test(raw)) { setAuthKind("passphrase"); setAuthTarget(systemSshPassphraseTarget(reason)); }
        else if (/No authentication method provided|SSH_PASSWORD_REJECTED|password.*(?:rejected|failed)/i.test(raw)) setAuthKind("password");
      }
    });
    return () => { current = false; picker.close(); };
  }, [connection, backend, preparedId, listening, direct, auth, authEdited]);

  useEffect(() => () => { alive.current = false; epoch.current++; pickerRef.current?.close(); }, []);

  function restart(nextType: SessionType, keep: boolean, nextError = "") {
    epoch.current++; pickerRef.current?.close(); pickerRef.current = null;
    preserve.current = keep ? { selection, name } : null;
    setListing(null); setReady(false); setLoading(nextType !== "none"); setError(nextError);
    if (!keep) { setSelection(null); setName(""); setAuthKind(null); setAuthText(""); setAuth(undefined); }
    setType(nextType); setPreparedId(crypto.randomUUID());
  }

  function cancel() {
    dismissed.current = true; alive.current = false; epoch.current++; busyRef.current = true;
    setAuth(undefined); setAuthText("");
    pickerRef.current?.close();
  }
  const close = () => { cancel(); onClose(); };
  const selectedNew = selection?.kind === "new";
  const invalidName = !name.trim() || new TextEncoder().encode(name).length > (backend === "zellij" ? 48 : 128)
    || name.startsWith("-") || /[\p{Cc}]/u.test(name)
    || (backend === "tmux" ? /[.:]/.test(name) : name.includes("/") || name === "." || name === "..");
  const duplicate = selectedNew && listing?.reserved_names.includes(name);
  const canConnect = !loading && !busy && (authEdited || (authKind && !!authText) || (ready && (type === "none" ||
    (listing?.installed && selection && (!selectedNew || (!invalidName && !duplicate))))));

  function connect() {
    const picker = pickerRef.current;
    if (!canConnect || busyRef.current || composing.current) return;
    if (authEdited) { setAuthEdited(false); restart(type, false); return; }
    if (!picker) return;
    if (authKind) {
      setAuth((previous) => authKind === "passphrase" && authTarget
        ? { ...previous, systemPassphrases: { ...previous?.systemPassphrases, [authTarget]: authText } }
        : { ...previous, [authKind]: authText });
      setAuthKind(null); setAuthText(""); restart(type, true);
      return;
    }
    busyRef.current = true; setBusy(true); setError("");
    const generation = epoch.current;
    const operation = type === "none" ? picker.open() : selection?.kind === "existing" ? picker.attach(selection.remote)
      : backend ? picker.open({ backend, choice: { kind: "create", name } }) : Promise.reject(new Error("SESSION_SELECTION_REQUIRED"));
    void operation.then((id) => { if (alive.current && generation === epoch.current) onOpened(id); }, (reason) => {
      if (alive.current && generation === epoch.current) {
        // Replace consumed one-use transport while keeping the error and valid form input.
        restart(type, true, describeSessionError(reason));
      }
    }).finally(() => {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    });
  }

  const selectedValue = selection?.kind === "new" ? NEW_VALUE : selection?.kind === "existing"
    ? `existing:${listing?.sessions.findIndex((s) => sameRemoteSession(s, selection.remote)) ?? -1}` : "";

  const form = <form className="px-4 pb-4 overflow-y-auto" data-session-picker onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onSubmit={(event) => { event.preventDefault(); connect(); }}>
      <p className="text-sm text-(--t-text-primary)">{connectionDisplayName(connection)}</p>
      {presentation === "dialog" && <SystemSshAuthFields connectionId={connection.id} disabled={busy} onChange={() => {
        epoch.current++; pickerRef.current?.close(); pickerRef.current = null;
        setAuthEdited(type !== "none"); setLoading(false); setReady(false); setListing(null); setSelection(null); setName("");
        if (type === "none") setPreparedId(crypto.randomUUID());
        setAuth(undefined); setAuthText(""); setAuthKind(null); setError(t("connections.systemAuth.refreshHint"));
      }} />}
      <label className="block text-sm mt-3" htmlFor="ssh-session-type">{t("mobile.session.type")}</label>
      <select id="ssh-session-type" value={type} disabled={busy} className="w-full rounded-lg border p-2 mt-1 bg-(--t-bg-card) border-(--t-border)"
        onChange={(event) => { if (dismissed.current || busyRef.current) return; const value = event.target.value as SessionType; useSshSessionTypeStore.getState().setType(connection.id, value); restart(value, false); }}>
        <option value="none">None</option><option value="tmux">Tmux</option><option value="zellij">Zellij</option>
      </select>
      {type === "none" && <p className="text-xs text-(--t-text-dim) mt-2">{t("mobile.session.noneHint")}</p>}
      {listing?.version && <p className="text-xs text-(--t-text-dim) mt-2">{listing.version}</p>}
      {authKind && <div className="mt-3">
        <label className="block text-sm" htmlFor="ssh-session-auth">{t(authKind === "passphrase" ? "mobile.session.authPassphrase" : "mobile.session.authPassword")}</label>
        <input id="ssh-session-auth" type="password" autoComplete="off" value={authText} onChange={(event) => setAuthText(event.target.value)}
          className="w-full rounded-lg border p-2 mt-1 bg-(--t-bg-card) border-(--t-border)" />
        <p className="text-xs text-(--t-text-dim) mt-1">{t("mobile.session.authHint")}</p>
      </div>}
      {backend && <>
        <div className="flex items-center justify-between mt-4">
          <label className="text-sm" htmlFor="ssh-session-list">{t("mobile.session.list")}</label>
          <button type="button" aria-label={t("mobile.session.refresh")} title={t("mobile.session.refresh")} disabled={loading || busy}
            onClick={() => { if (!dismissed.current && !busyRef.current) restart(type, true); }} className="px-2 py-1 text-(--t-accent) disabled:opacity-50">↻</button>
        </div>
        <select id="ssh-session-list" value={selectedValue} disabled={busy || loading || !listing?.installed}
          className="w-full rounded-lg border p-2 mt-1 bg-(--t-bg-card) border-(--t-border)"
          onChange={(event) => {
            if (dismissed.current || busyRef.current) return;
            const value = event.target.value;
            if (value === NEW_VALUE) setSelection({ kind: "new" });
            else if (value.startsWith("existing:")) {
              const remote = listing?.sessions[Number(value.slice(9))];
              if (!remote) return;
              setSelection({ kind: "existing", remote });
            } else return;
            setError("");
          }}>
          <option value="" disabled>{loading ? t("mobile.session.loading") : t("mobile.session.choose")}</option>
          <option value={NEW_VALUE} style={{ fontWeight: "bold" }}>＋ New</option>
          {!!listing?.sessions.length && <option value="separator" disabled>──────────</option>}
          {!!listing?.sessions.length && <optgroup label={t("mobile.session.existing")}>
            {listing.sessions.map((remote, index) => <option key={`${remote.backend}:${index}`} value={`existing:${index}`}>
              {remote.session.name} · {remote.backend === "tmux" ? t("mobile.tmux.details", { windows: remote.session.windows, attached: remote.session.attached }) : t("mobile.session.running")}
            </option>)}
          </optgroup>}
        </select>
        {listing && !listing.installed && <p role="status" className="text-sm mt-2">{t("mobile.session.missing", { backend: type === "tmux" ? "Tmux" : "Zellij" })}</p>}
        {listing?.installed && !listing.sessions.length && <p role="status" className="text-xs mt-2 text-(--t-text-dim)">{t("mobile.session.empty")}</p>}
        {backend === "zellij" && <p className="text-xs mt-2 text-(--t-text-dim)">{t("mobile.session.runningOnly")}</p>}
        {selectedNew && <>
        <label className="block text-sm mt-4" htmlFor="ssh-session-name">{t("mobile.session.name")}</label>
        <input id="ssh-session-name" type="text" autoCapitalize="none" autoCorrect="off" autoComplete="off" value={name}
          disabled={busy || loading || !listing?.installed} aria-invalid={!!duplicate || (!!name && invalidName)}
          onChange={(event) => { setName(event.target.value); setError(""); }}
          className="w-full rounded-lg border p-2 mt-1 bg-(--t-bg-card) border-(--t-border) disabled:opacity-50" />
        <p className="text-xs text-(--t-text-dim) mt-1">{t(backend === "tmux" ? "mobile.tmux.nameHint" : "mobile.session.zellijNameHint")}</p>
        {duplicate && <p role="alert" className="text-sm text-(--t-danger) mt-2">{t("mobile.session.duplicate")}</p>}
        </>}
      </>}
      {loading && <p role="status" className="text-sm mt-2">{t("mobile.session.loading")}</p>}
      {error && <p role="alert" className="text-sm text-(--t-danger) whitespace-pre-wrap mt-2">{error}</p>}
      {conflict && <HostKeyConflictPanel conflict={conflict} resolving={resolving} onResolve={(action) => void resolveConflict(action)} />}
      <div className="flex gap-3 mt-5">
        <button type="button" onClick={close} className="flex-1 rounded-lg border border-(--t-border) px-3 py-2">{t("common.action.cancel")}</button>
        <button type="submit" disabled={!canConnect} className="flex-1 rounded-lg bg-(--t-accent) text-white px-3 py-2 disabled:opacity-50">
          {t(busy ? "mobile.session.opening" : "mobile.session.connect")}
        </button>
      </div>
    </form>;
  return presentation === "sheet"
    ? <BottomSheet title={t("mobile.session.title")} onClose={close} onDismissStart={cancel}>{form}</BottomSheet>
    : <Modal onClose={close}><ModalCard className="w-[min(28rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto py-4">
      <h2 className="px-4 mb-2 text-base font-semibold">{t("mobile.session.title")}</h2>{form}
    </ModalCard></Modal>;
}
