import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/types";
import { createTmuxPicker, type TmuxPicker } from "@/services/tmuxPicker";
import type { TmuxListing } from "@/services/ssh";
import { describeError } from "@/services/backendErrors";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import BottomSheet from "./BottomSheet";
import { SheetActionRow } from "./SheetActionRow";
import { useHostKeyConflict } from "@/components/terminal/connection-overlay/hooks";
import { HostKeyConflictPanel } from "@/components/terminal/connection-overlay/HostKeyConflictPanel";

export default function TmuxSessionSheet({ connection, onClose, onOpened }: {
  connection: Connection; onClose: () => void; onOpened: () => void;
}) {
  const { t } = useTranslation();
  const translate = useRef(t);
  translate.current = t;
  const pickerRef = useRef<TmuxPicker | null>(null);
  const [preparedId, setPreparedId] = useState(() => crypto.randomUUID());
  const [listing, setListing] = useState<TmuxListing | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failedChoice, setFailedChoice] = useState(false);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const { conflict, resolving, resolveConflict, listening } = useHostKeyConflict({
    sessionId: preparedId, status: error ? "error" : listing ? "connected" : "connecting",
    conflictEventName: `ssh-host-key-conflict-${preparedId}`,
  });

  useEffect(() => {
    // Subscribe before starting the handshake; a changed key must use the existing trust UI.
    if (!listening) return;
    alive.current = true;
    setListing(null);
    setError("");
    setFailedChoice(false);
    const picker = createTmuxPicker(connection, preparedId);
    let current = true;
    pickerRef.current = picker;
    void picker.ready.then((value) => { if (current && alive.current) setListing(value); },
      (reason) => { if (current && alive.current) setError(describeTmuxError(reason)); });
    return () => { current = false; alive.current = false; picker.close(); };
  }, [connection, preparedId, listening]);

  function describeTmuxError(reason: unknown): string {
    const message = describeError(reason, translate.current);
    if (message.includes("duplicate session")) return translate.current("mobile.tmux.duplicate");
    if (/TMUX_PICKER_|TMUX_SESSION_CHANGED/.test(message)) return translate.current("mobile.tmux.expired");
    if (message.includes("TMUX_INVALID_NAME")) return translate.current("mobile.tmux.invalidName");
    if (message.includes("TMUX_COMMAND_TIMEOUT")) return translate.current("mobile.tmux.timeout");
    return message.replace(/^TMUX_(?:LIST|CHOICE)_FAILED:\s*/, "");
  }

  const close = () => {
    alive.current = false;
    pickerRef.current?.close();
    onClose();
  };
  const cancelPending = () => {
    alive.current = false;
    busyRef.current = true;
    setBusy(true);
    pickerRef.current?.close();
  };
  const launch = (open: (picker: TmuxPicker) => Promise<string>) => {
    if (busyRef.current || !pickerRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    void open(pickerRef.current).then(() => {
      if (alive.current) onOpened();
    }, (reason) => {
      if (alive.current) { setError(describeTmuxError(reason)); setFailedChoice(true); }
    }).finally(() => {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    });
  };
  const invalidName = !name.trim() || new TextEncoder().encode(name).length > 128 || /^-/.test(name) || /[\p{Cc}.:]/u.test(name);

  return <BottomSheet title={t("mobile.tmux.title")} onClose={close} onDismissStart={cancelPending}>
    <div className="px-4 pb-4 overflow-y-auto" data-tmux-picker>
      <p className="text-sm text-(--t-text-primary)">{connectionDisplayName(connection)}</p>
      <p className="text-xs text-(--t-text-dim) mb-3">{t("mobile.tmux.scope")}</p>
      {!listing && !error && <p role="status">{t("mobile.tmux.connecting")}</p>}
      {busy && <p role="status">{t("mobile.tmux.opening")}</p>}
      {error && <p role="alert" className="text-sm text-(--t-danger) whitespace-pre-wrap">{error}</p>}
      {conflict && <HostKeyConflictPanel conflict={conflict} resolving={resolving} onResolve={(action) => void resolveConflict(action)} />}
      {listing && !listing.installed && <p role="status">{t("mobile.tmux.missing")}</p>}
      {listing?.installed && listing.sessions.length === 0 && <p role="status">{t("mobile.tmux.empty")}</p>}
      {listing?.sessions.map((session) => <SheetActionRow key={`${session.server_pid}:${session.created}:${session.id}`}
        attr="tmux-session" it={{ icon: "lucide:terminal", slug: session.id,
          label: `${session.name} · ${t("mobile.tmux.details", { windows: session.windows, attached: session.attached })}`,
          disabled: busy || failedChoice, onTap: () => launch((picker) => picker.attach(session)),
        }} />)}
      {listing?.installed && <form onSubmit={(event) => { event.preventDefault(); if (!invalidName) launch((picker) => picker.open({ kind: "create", name })); }}>
        <label className="block text-sm mt-3" htmlFor="tmux-new-name">{t("mobile.tmux.newName")}</label>
        <input id="tmux-new-name" type="text" autoCapitalize="none" autoCorrect="off" autoComplete="off"
          className="w-full rounded-lg border p-2 mt-1 bg-(--t-bg-card) border-(--t-border)"
          value={name} onChange={(event) => setName(event.target.value)} disabled={busy || failedChoice} />
        <p className="text-xs text-(--t-text-dim) mt-1">{t("mobile.tmux.nameHint")}</p>
        <button type="submit" data-tmux-create disabled={busy || failedChoice || invalidName}
          className="rounded-lg bg-(--t-accent) px-3 py-2 mt-2 text-white disabled:opacity-50">{t("mobile.tmux.create")}</button>
      </form>}
      <SheetActionRow attr="tmux-action" it={{ icon: "lucide:refresh-cw", slug: "refresh", label: t("mobile.tmux.refresh"), disabled: busy,
        onTap: () => { pickerRef.current?.close(); setPreparedId(crypto.randomUUID()); } }} />
      <SheetActionRow attr="tmux-action" it={{ icon: "lucide:terminal", slug: "plain-ssh", label: t("mobile.tmux.plain"), disabled: busy || failedChoice,
        onTap: () => launch((picker) => picker.open()) }} />
      <SheetActionRow attr="tmux-action" it={{ icon: "lucide:x", slug: "cancel", label: t("common.action.cancel"), onTap: close }} />
    </div>
  </BottomSheet>;
}
