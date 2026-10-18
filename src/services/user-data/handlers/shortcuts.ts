import i18n from "@/i18n";
import { useShortcutStore } from "@/stores/shortcutStore";
import { pushSettingsChange, settingsStamp } from "@/stores/remoteApplyGuard";
import { lastWriteWins, type UserDataHandler } from "../handler";

interface ShortcutOverride {
  id: string;
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  allowInTerminal?: boolean;
}

export const shortcutsHandler: UserDataHandler = {
  key: "shortcuts",
  icon: "lucide:keyboard",

  export(): ShortcutOverride[] {
    return useShortcutStore.getState().shortcuts.map(({ id, key, ctrl, shift, alt, allowInTerminal }) => ({ id, key, ctrl, shift, alt: alt ?? false, ...(allowInTerminal === true && { allowInTerminal: true }) }));
  },

  async import(data: unknown): Promise<void> {
    const overrides = data as ShortcutOverride[];
    const store = useShortcutStore.getState();
    for (const o of (overrides ?? [])) {
      store.setKey(o.id, o.key, o.ctrl, o.shift, o.alt ?? false);
      store.setTerminalAllowed(o.id, o.allowInTerminal === true);
    }
  },

  merge: lastWriteWins,

  getTimestamp(): string {
    return useShortcutStore.getState().shortcutsUpdatedAt;
  },

  touch(): void {
    useShortcutStore.setState({ shortcutsUpdatedAt: settingsStamp() });
    pushSettingsChange();
  },

  describe(): string {
    const overrides = useShortcutStore.getState().shortcuts.filter(
      (sc) => sc.key !== sc.defaultKey,
    );
    return overrides.length > 0
      ? i18n.t("importExport.userData.describe.shortcutsOverrides", { count: overrides.length })
      : i18n.t("importExport.userData.describe.shortcutsDefaults");
  },
};
