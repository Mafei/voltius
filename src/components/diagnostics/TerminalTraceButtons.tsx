import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { markTerminalProblem } from "@/services/terminalDiagnosticReport";
import { appToast } from "@/services/appToast";
/** Pointer-down captures before the button can borrow editor/IME focus. */
export function TerminalTraceButtons({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const mark = (kind: "input" | "render") => { markTerminalProblem(kind); appToast("success", t("settings.diagnostics.traceMarked", { defaultValue: "Problem marked in memory" })); };
  return <span className="inline-flex shrink-0">
    {(["input", "render"] as const).map((kind) => <button key={kind} type="button"
      className={`inline-flex items-center justify-center ${compact ? "min-h-6 min-w-6" : "min-h-8 min-w-8"} text-(--t-text-dim)`}
      title={t(`settings.diagnostics.${kind === "input" ? "traceInput" : "traceRender"}`, { defaultValue: kind === "input" ? "Mark input failure" : "Mark garbled text" })}
      aria-label={t(`settings.diagnostics.${kind === "input" ? "traceInput" : "traceRender"}`, { defaultValue: kind === "input" ? "Mark input failure" : "Mark garbled text" })}
      onPointerDown={(e) => { e.preventDefault(); mark(kind); }}
      onClick={(e) => { if (e.detail === 0) mark(kind); }}>
      <Icon icon={kind === "input" ? "lucide:keyboard-off" : "lucide:wrap-text"} width={14} />
    </button>)}
  </span>;
}
