import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { PassphrasePromptPanel } from "@/components/terminal/connection-overlay/PassphrasePromptPanel";
import { answerSystemSshUnlock, cancelSystemSshUnlocks, useSystemSshUnlockStore } from "@/services/systemSshUnlock";
import { findAnyConnection } from "@/stores/connectionStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";

export function SystemSshUnlockHost() {
  const challenge = useSystemSshUnlockStore((s) => s.pending[0]);
  const generation = useRef(0); const { t } = useTranslation();
  useEffect(() => { const current = ++generation.current; return () => { queueMicrotask(() => { if (generation.current === current) cancelSystemSshUnlocks(); }); }; }, []);
  if (!challenge) return null;
  const connection = findAnyConnection(challenge.connectionId);
  const cancel = () => answerSystemSshUnlock(challenge.token, null);
  return <Modal onClose={cancel}><ModalCard className="w-96 p-5">
    <p className="mb-3 text-sm">{connection ? connectionDisplayName(connection) : t("connections.systemAuth.label")}</p>
    <p className="mb-3 text-xs text-(--t-text-dim)">{t("mobile.session.authHint")}</p>
    <PassphrasePromptPanel key={challenge.token} allowSave={false} onSubmit={(value) => answerSystemSshUnlock(challenge.token, value)} onCancel={cancel} />
  </ModalCard></Modal>;
}
