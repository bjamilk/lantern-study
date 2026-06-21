import { useSettingsStore } from '../stores/settingsStore';

/** Reads low-data mode from synced settings (matches web uiStore behavior). */
export function useLowDataMode() {
  const lowDataMode = useSettingsStore(s => s.settings.appearance.lowDataMode);
  const updateSettings = useSettingsStore(s => s.updateSettings);

  const toggleLowDataMode = () => {
    void updateSettings('appearance', { lowDataMode: !lowDataMode });
  };

  return { lowDataMode, toggleLowDataMode, setLowDataMode: (v: boolean) => void updateSettings('appearance', { lowDataMode: v }) };
}
