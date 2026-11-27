import type { MermaidConfig } from "@streamdown/mermaid";
import palettes from "../../lib/appearance/catppuccin.json";
import { getFalconPalette } from "../../lib/appearance/falcon";
import { FALCON_THEMES } from "../../lib/appearance/falconCatalog";
import { useDocumentAppearance } from "../../lib/appearance/useDocumentAppearance";

function catppuccinConfig(p: typeof palettes.latte, darkMode: boolean): MermaidConfig {
  return {
    theme: "base",
    themeVariables: {
      darkMode,
      background: p.base,
      primaryColor: p.surface0,
      primaryTextColor: p.text,
      primaryBorderColor: p.mauve,
      secondaryColor: p.mantle,
      secondaryTextColor: p.text,
      secondaryBorderColor: p.blue,
      tertiaryColor: p.surface1,
      tertiaryTextColor: p.text,
      tertiaryBorderColor: p.teal,
      lineColor: p.subtext1,
      textColor: p.text,
      mainBkg: p.surface0,
      nodeBorder: p.mauve,
      clusterBkg: p.mantle,
      clusterBorder: p.surface2,
      titleColor: p.text,
      edgeLabelBackground: p.base,
      noteBkgColor: p.surface1,
      noteTextColor: p.text,
      noteBorderColor: p.yellow,
      actorBkg: p.surface0,
      actorTextColor: p.text,
      actorBorder: p.mauve,
      actorLineColor: p.overlay1,
      signalColor: p.text,
      signalTextColor: p.text,
      labelBoxBkgColor: p.mantle,
      labelBoxBorderColor: p.surface2,
      labelTextColor: p.text,
      loopTextColor: p.text,
      activationBkgColor: p.surface1,
      activationBorderColor: p.mauve,
    },
  };
}

const configs: Record<string, MermaidConfig> = {
  "default:light": { theme: "default" },
  "default:dark": { theme: "dark" },
  "catppuccin:light": catppuccinConfig(palettes.latte, false),
  "catppuccin:dark": catppuccinConfig(palettes.mocha, true),
};

for (const theme of FALCON_THEMES) {
  const p = getFalconPalette(theme.id);
  if (!p) continue;
  const config: MermaidConfig = {
    theme: "base",
    themeVariables: {
      darkMode: theme.mode === "dark",
      background: p.background,
      primaryColor: p.hover,
      primaryTextColor: p.foreground,
      primaryBorderColor: p.accent,
      secondaryColor: p.rail,
      secondaryTextColor: p.foreground,
      secondaryBorderColor: p.border,
      tertiaryColor: p.selection,
      tertiaryTextColor: p.foreground,
      tertiaryBorderColor: p.accent,
      lineColor: p.muted,
      textColor: p.foreground,
      mainBkg: p.hover,
      nodeBorder: p.accent,
      clusterBkg: p.rail,
      clusterBorder: p.border,
      titleColor: p.foreground,
      edgeLabelBackground: p.background,
      noteBkgColor: p.selection,
      noteTextColor: p.foreground,
      noteBorderColor: p.accent,
      actorBkg: p.hover,
      actorTextColor: p.foreground,
      actorBorder: p.accent,
      actorLineColor: p.muted,
      signalColor: p.foreground,
      signalTextColor: p.foreground,
      labelBoxBkgColor: p.rail,
      labelBoxBorderColor: p.border,
      labelTextColor: p.foreground,
      loopTextColor: p.foreground,
      activationBkgColor: p.selection,
      activationBorderColor: p.accent,
    },
  };
  configs[`${theme.id}:light`] = config;
  configs[`${theme.id}:dark`] = config;
}

export function useMermaidConfig() {
  return configs[useDocumentAppearance()] ?? configs["default:light"];
}
