import "@liveagent/ui/i18n/namespaces/settings";
import completionSound from "./presets/completion-sound.ps1?raw";
import projectCheck from "./presets/project-check.ps1?raw";
import type { HookDef } from "./types";

export type BuiltinHookPreset = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  source: string;
  sourceUrl: string;
  script: string;
  timeoutMs: number;
};

const sourceBase =
  "https://github.com/affaan-m/everything-claude-code/blob/4adeee6732a12d1540f49a4d50a38ce8c97f9a53";
export const BUILTIN_HOOK_PRESETS: readonly BuiltinHookPreset[] = [
  {
    id: "completion-sound",
    titleKey: "settings.hookPresetSound",
    descriptionKey: "settings.hookPresetSoundDesc",
    source: "ECC · desktop-notify · MIT",
    sourceUrl: `${sourceBase}/scripts/hooks/desktop-notify.js`,
    script: completionSound,
    timeoutMs: 10000,
  },
  {
    id: "git-diff",
    titleKey: "settings.hookPresetGit",
    descriptionKey: "settings.hookPresetGitDesc",
    source: "openAgent · Git diff --check",
    sourceUrl: "https://git-scm.com/docs/git-diff",
    script: `$OpenAgentCheck = 'git-diff'\n${projectCheck}`,
    timeoutMs: 30000,
  },
  {
    id: "typecheck",
    titleKey: "settings.hookPresetTypes",
    descriptionKey: "settings.hookPresetTypesDesc",
    source: "ECC · post-edit-typecheck · MIT",
    sourceUrl: `${sourceBase}/scripts/hooks/post-edit-typecheck.js`,
    script: `$OpenAgentCheck = 'typecheck'\n${projectCheck}`,
    timeoutMs: 120000,
  },
  {
    id: "lint",
    titleKey: "settings.hookPresetLint",
    descriptionKey: "settings.hookPresetLintDesc",
    source: "ECC · stop-format-typecheck · MIT",
    sourceUrl: `${sourceBase}/scripts/hooks/stop-format-typecheck.js`,
    script: `$OpenAgentCheck = 'lint'\n${projectCheck}`,
    timeoutMs: 120000,
  },
  {
    id: "test",
    titleKey: "settings.hookPresetTests",
    descriptionKey: "settings.hookPresetTestsDesc",
    source: "ECC · verification-loop · MIT",
    sourceUrl: `${sourceBase}/skills/verification-loop/SKILL.md`,
    script: `$OpenAgentCheck = 'test'\n${projectCheck}`,
    timeoutMs: 300000,
  },
];

export function builtinHookId(preset: BuiltinHookPreset): string {
  return `openagent-preset:${preset.id}`;
}

export function builtinHookDefaults(
  preset: BuiltinHookPreset,
  t: (key: string) => string,
): Omit<HookDef, "id"> {
  return {
    name: t(preset.titleKey),
    description: `${t(preset.descriptionKey)} · ${preset.source}`,
    event: "agent_end",
    enabled: false,
    type: "command",
    script: preset.script,
    timeoutMs: preset.timeoutMs,
  };
}
