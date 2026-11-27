import type { ThemeInput } from "@streamdown/code";
import type { ColorTheme } from "../settings/types";
import { getFalconPalette } from "./falcon";
import { getFalconTheme } from "./falconCatalog";

const defaultThemes: [ThemeInput, ThemeInput] = ["github-light", "github-dark"];
const themes = new Map<ColorTheme, [ThemeInput, ThemeInput]>([
  ["default", defaultThemes],
  ["catppuccin", ["catppuccin-latte", "catppuccin-mocha"]],
]);

/** Stable named themes preserve the streaming highlighter's bounded cache keys. */
export function getMarkdownThemes(family: ColorTheme): [ThemeInput, ThemeInput] {
  const cached = themes.get(family);
  if (cached) return cached;
  const info = getFalconTheme(family);
  const p = getFalconPalette(family);
  if (!info || !p) return defaultThemes;
  const theme: ThemeInput = {
    name: `openagent-${info.id}`,
    type: info.mode,
    colors: { "editor.background": p.editor.background, "editor.foreground": p.editor.foreground },
    tokenColors: [
      { scope: "comment", settings: { foreground: p.syntax.comment, fontStyle: "italic" } },
      { scope: ["keyword", "storage"], settings: { foreground: p.syntax.keyword } },
      { scope: "string", settings: { foreground: p.syntax.string } },
      {
        scope: ["constant.numeric", "constant.language"],
        settings: { foreground: p.syntax.number },
      },
      {
        scope: ["entity.name.type", "support.type", "support.class"],
        settings: { foreground: p.syntax.type },
      },
      {
        scope: ["entity.name.function", "support.function"],
        settings: { foreground: p.syntax.function },
      },
      { scope: "variable", settings: { foreground: p.syntax.variable } },
      { scope: "keyword.operator", settings: { foreground: p.syntax.operator } },
      {
        scope: ["entity.other.attribute-name", "entity.name.tag"],
        settings: { foreground: p.syntax.attribute },
      },
      { scope: "constant", settings: { foreground: p.syntax.constant } },
    ],
  };
  const pair: [ThemeInput, ThemeInput] = [theme, theme];
  themes.set(family, pair);
  return pair;
}
