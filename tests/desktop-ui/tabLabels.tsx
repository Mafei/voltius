import { useState } from "react";
import { TitlebarTab, SessionTabLabel, sessionTabIcon } from "@/components/layout/TitlebarTab";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import type { TerminalSession } from "@/types";

function mux(id: string, name: string, backend: "tmux" | "zellij", customTitle?: string): TerminalSession {
  const target = { username: "alice", endpoint: "synthetic.example.invalid:22" };
  return {
    id, connectionId: "synthetic-tab-layout", connectionName: "合成主机 / Synthetic host", type: "ssh", status: "connected", customTitle,
    sshMode: backend === "tmux"
      ? { kind: backend, ...target, session: { id: "$1", name, windows: 1, attached: 0, created: 1, server_pid: 1 } }
      : { kind: backend, ...target, session: { name, socket_dir: "/synthetic", socket_id: "1:2" } },
  };
}
const cases: TerminalSession[] = [
  mux("tmux-short", "test", "tmux"),
  mux("zellij-cn", "工作会话", "zellij"),
  mux("tmux-long", "Deploy-gjpqy-é-é-very-long-session-name-for-ellipsis-checking", "tmux"),
  mux("zellij-long", "中文会话-开发环境-混合 English-gjpqy-终端名称很长", "zellij"),
  mux("renamed", "original-remote-session", "tmux", "自定义名称 / Renamed gjpqy"),
  { id: "plain", connectionId: "synthetic-plain", connectionName: "Synthetic SSH", title: "plain-shell-gjpqy", type: "ssh", status: "connected", sshMode: { kind: "plain" } },
  { id: "local", connectionId: "synthetic-local", connectionName: "Local Shell", title: "Local Shell › Zsh", type: "local", status: "connected" },
];

export default function TabLabelFixture() {
  useApplyTheme();
  const [closed, setClosed] = useState(0);
  return <main data-tab-layout-fixture className="chrome-frame w-max min-w-full min-h-screen p-6">
    <style>{`html,body,#root{overflow:visible!important;height:auto!important}
      /* Reproduce the previous inherited styles without a second component implementation. */
      [data-legacy-tab-lines] [data-session-primary]{font-size:var(--text-base);line-height:var(--text-base--line-height)}
      [data-legacy-tab-lines] [data-session-secondary]{font-size:10px;line-height:inherit}`}</style>
    <h1 className="text-xl mb-2">Synthetic titlebar layout verification</h1>
    <p className="mb-4">Real production tabs; no SSH, user hosts or credentials. Closed: <output data-close-count>{closed}</output></p>
    <div className="grid grid-cols-[150px_auto_auto] items-center gap-x-6 gap-y-3">
      <span>Case</span><span>Selected</span><span>Unselected</span>
      {cases.map((session) => [<span key={`${session.id}-name`}>{session.id}</span>, ...[true, false].map((active) => <div key={`${session.id}-${active}`} data-tab-case={session.id} data-selected={active} className="w-max">
        <TitlebarTab itemKey={`${session.id}-${active}`} active={active} icon={sessionTabIcon(session, undefined, active, "connected")}
          label={<SessionTabLabel session={session} />} renaming={false} renameValue="" renameAriaLabel="Rename synthetic tab"
          onRenameCommit={() => {}} onRenameCancel={() => {}} onClick={() => {}} onLabelClick={() => {}}
          onClose={(event) => { event.stopPropagation(); setClosed((count) => count + 1); }}
          onContextMenu={() => {}} onDoubleClick={() => {}} onPointerDown={() => {}} />
      </div>)])}
    </div>
  </main>;
}
