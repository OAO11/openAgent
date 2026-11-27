import "@liveagent/ui/i18n/namespaces/settings";
import type { SettingsSectionProps } from "@liveagent/app/pages/settings/types";
import { SettingsCombobox } from "../../components/settings/SettingsCombobox";
import {
  SettingsToggleGroup,
  SettingsToggleGroupItem,
} from "../../components/settings/SettingsToggleGroup";
import { useLocale } from "../../i18n/index";
import { FALCON_THEMES, getFalconTheme } from "../../lib/appearance/falconCatalog";
import { normalizeColorTheme } from "../../lib/settings/themeAndMemory";
import { THEME_OPTIONS, type Theme } from "../../lib/settings/types";
import { SettingsRow } from "./shared";

export function AppearanceThemeSettings({ settings, setSettings }: SettingsSectionProps) {
  const { t, locale } = useLocale();
  const preset = getFalconTheme(settings.colorTheme);
  const modeLabel = (mode: Theme) =>
    t(mode === "light" ? "settings.light" : mode === "dark" ? "settings.dark" : "settings.auto");
  const options = [
    { value: "default", label: t("settings.colorThemeDefault") },
    {
      value: "catppuccin",
      label: "Catppuccin · Latte / Mocha",
      swatches: { background: "#eff1f5", surface: "#1e1e2e", accent: "#cba6f7" },
    },
    ...FALCON_THEMES.map((theme) => ({
      value: theme.id,
      label: `${locale === "zh-CN" ? theme.labelZh : theme.name} · ${modeLabel(theme.mode)}`,
      swatches: { background: theme.background, surface: theme.rail, accent: theme.accent },
    })),
  ];
  return (
    <>
      <SettingsRow
        data-settings-anchor="appearance"
        title={t("settings.colorTheme")}
        description={t("settings.colorThemeDesc")}
        control={
          <SettingsCombobox
            value={settings.colorTheme}
            options={options}
            ariaLabel={t("settings.colorTheme")}
            searchPlaceholder={t("settings.themeSearch")}
            emptyLabel={t("settings.themeEmpty")}
            triggerClassName="w-64 max-w-full gap-2"
            onValueChange={(value) => {
              const colorTheme = normalizeColorTheme(value);
              const selected = getFalconTheme(colorTheme);
              setSettings((prev) => ({ ...prev, colorTheme, theme: selected?.mode ?? prev.theme }));
            }}
          />
        }
      />
      <SettingsRow
        data-settings-anchor="theme-mode"
        title={t("settings.themeMode")}
        description={t(preset ? "settings.themePresetModeDesc" : "settings.themeModeDesc")}
        control={
          preset ? (
            <span className="text-sm text-muted-foreground">{modeLabel(preset.mode)}</span>
          ) : (
            <SettingsToggleGroup
              value={[settings.theme]}
              aria-label={t("settings.themeMode")}
              onValueChange={(values) => {
                const theme = THEME_OPTIONS.find((option) => option === values[0]);
                if (theme) setSettings((prev) => ({ ...prev, theme }));
              }}
            >
              {THEME_OPTIONS.map((theme) => (
                <SettingsToggleGroupItem key={theme} value={theme}>
                  {modeLabel(theme)}
                </SettingsToggleGroupItem>
              ))}
            </SettingsToggleGroup>
          )
        }
      />
    </>
  );
}
