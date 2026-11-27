import "@liveagent/ui/i18n/namespaces/settings";
import { openUrl } from "@liveagent/app/shims/tauriOpener";
import { Button } from "@liveagent/ui/components/ui/button";
import { useLocale } from "@liveagent/ui/i18n/index";
import {
  BUILTIN_HOOK_PRESETS,
  type BuiltinHookPreset,
  builtinHookId,
} from "@liveagent/ui/lib/automation/builtinHooks";
import type { HookDef } from "@liveagent/ui/lib/automation/types";

export function BuiltinHooksPanel({
  hooks,
  onSelect,
  onError,
}: {
  hooks: HookDef[];
  onSelect: (preset: BuiltinHookPreset) => void;
  onError: (message: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-4" data-settings-anchor="hooks-presets">
      <p className="text-sm text-muted-foreground">{t("settings.hooksPresetsDesc")}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {BUILTIN_HOOK_PRESETS.map((preset) => {
          const installed = hooks.some((hook) => hook.id === builtinHookId(preset));
          return (
            <article
              key={preset.id}
              className="flex min-w-0 flex-col gap-3 rounded-xl bg-settings-tile p-4"
            >
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">{t(preset.titleKey)}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(preset.descriptionKey)}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="cursor-pointer text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    void openUrl(preset.sourceUrl).catch((error) => onError(String(error)));
                  }}
                >
                  {preset.source}
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={installed}
                  onClick={() => onSelect(preset)}
                >
                  {t(installed ? "settings.hooksPresetAdded" : "settings.hooksPresetUse")}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="break-words text-xs leading-relaxed text-muted-foreground">
        {t("settings.hooksPresetsReports")}
      </p>
    </div>
  );
}
