import type { editor } from "monaco-editor";
import type { ColorTheme, EffectiveTheme } from "../settings/types";
import palettes from "./catppuccin.json";
import { getFalconPalette } from "./falcon";
import { getFalconTheme } from "./falconCatalog";

type ThemeRegistry = Pick<typeof editor, "defineTheme">;
const registered = new WeakSet<ThemeRegistry>();
const falconRegistered = new WeakMap<ThemeRegistry, Set<string>>();

export function createCatppuccinEditorTheme(mode: EffectiveTheme): editor.IStandaloneThemeData {
  const p = mode === "dark" ? palettes.mocha : palettes.latte;
  const token = (name: string, color: string, fontStyle?: string) => ({
    token: name,
    foreground: color.slice(1),
    ...(fontStyle ? { fontStyle } : {}),
  });
  return {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      token("", p.text),
      token("comment", p.overlay1, "italic"),
      token("keyword", p.mauve),
      token("string", p.green),
      token("number", p.peach),
      token("regexp", p.pink),
      token("type", p.yellow),
      token("type.identifier", p.yellow),
      token("identifier", p.text),
      token("function", p.blue),
      token("delimiter", p.subtext1),
      token("operator", p.sky),
      token("tag", p.blue),
      token("attribute.name", p.yellow),
      token("attribute.value", p.green),
    ],
    colors: {
      "editor.background": p.base,
      "editor.foreground": p.text,
      "editorCursor.foreground": p.rosewater,
      "editorLineNumber.foreground": p.overlay1,
      "editorLineNumber.activeForeground": p.lavender,
      "editor.selectionBackground": `${p.surface2}cc`,
      "editor.inactiveSelectionBackground": `${p.surface1}aa`,
      "editor.lineHighlightBackground": p.mantle,
      "editorIndentGuide.background1": p.surface1,
      "editorIndentGuide.activeBackground1": p.overlay0,
      "editorWhitespace.foreground": p.surface2,
      "editorWidget.background": p.mantle,
      "editorWidget.border": p.surface2,
      "editorSuggestWidget.background": p.mantle,
      "editorSuggestWidget.foreground": p.text,
      "editorSuggestWidget.selectedBackground": p.surface1,
      "editorSuggestWidget.highlightForeground": p.mauve,
      "editorHoverWidget.background": p.mantle,
      "editorHoverWidget.foreground": p.text,
      "editor.findMatchBackground": `${p.yellow}60`,
      "editor.findMatchHighlightBackground": `${p.yellow}30`,
      "editorError.foreground": p.red,
      "editorWarning.foreground": p.yellow,
      "editorInfo.foreground": p.blue,
      "editorGutter.addedBackground": p.green,
      "editorGutter.deletedBackground": p.red,
      "editorGutter.modifiedBackground": p.blue,
      "editorGutter.background": p.base,
      "scrollbarSlider.background": `${p.overlay0}40`,
      "scrollbarSlider.hoverBackground": `${p.overlay0}70`,
      "minimap.background": p.base,
      focusBorder: p.mauve,
    },
  };
}

export function createFalconEditorTheme(
  family: ColorTheme,
): editor.IStandaloneThemeData | undefined {
  const p = getFalconPalette(family);
  const info = getFalconTheme(family);
  if (!p || !info) return undefined;
  const e = p.editor;
  const token = (name: string, color: string, fontStyle?: string) => ({
    token: name,
    foreground: color.slice(1),
    ...(fontStyle ? { fontStyle } : {}),
  });
  return {
    base: info.mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      token("", e.foreground),
      token("comment", p.syntax.comment, "italic"),
      token("keyword", p.syntax.keyword),
      token("string", p.syntax.string),
      token("number", p.syntax.number),
      token("type", p.syntax.type),
      token("type.identifier", p.syntax.type),
      token("identifier", p.syntax.variable),
      token("function", p.syntax.function),
      token("delimiter", p.syntax.operator),
      token("operator", p.syntax.operator),
      token("tag", p.syntax.attribute),
      token("attribute.name", p.syntax.attribute),
      token("attribute.value", p.syntax.string),
    ],
    colors: {
      "editor.background": e.background,
      "editor.foreground": e.foreground,
      "editorCursor.foreground": e.cursor,
      "editorLineNumber.foreground": e.lineNumber,
      "editorLineNumber.activeForeground": p.accent,
      "editor.selectionBackground": e.selection,
      "editor.inactiveSelectionBackground": `${e.selection}90`,
      "editor.lineHighlightBackground": e.line,
      "editorIndentGuide.background1": e.indent,
      "editorIndentGuide.activeBackground1": p.border,
      "editorWhitespace.foreground": p.border,
      "editorWidget.background": p.background,
      "editorWidget.border": p.border,
      "editorSuggestWidget.background": p.background,
      "editorSuggestWidget.foreground": p.foreground,
      "editorSuggestWidget.selectedBackground": p.selection,
      "editorSuggestWidget.highlightForeground": p.accent,
      "editorHoverWidget.background": p.background,
      "editorHoverWidget.foreground": p.foreground,
      "editor.findMatchBackground": `${p.terminal.yellow}60`,
      "editor.findMatchHighlightBackground": `${p.terminal.yellow}30`,
      "editorError.foreground": p.terminal.red,
      "editorWarning.foreground": p.terminal.yellow,
      "editorInfo.foreground": p.terminal.blue,
      "editorGutter.addedBackground": p.terminal.green,
      "editorGutter.deletedBackground": p.terminal.red,
      "editorGutter.modifiedBackground": p.terminal.blue,
      "editorGutter.background": e.background,
      "scrollbarSlider.background": `${p.border}60`,
      "scrollbarSlider.hoverBackground": `${p.border}90`,
      "minimap.background": e.background,
      focusBorder: p.accent,
    },
  };
}

export function resolveEditorTheme(
  api: ThemeRegistry,
  family: ColorTheme,
  mode: EffectiveTheme,
): string {
  if (getFalconTheme(family)) {
    const name = `openagent-${family}`;
    let names = falconRegistered.get(api);
    if (!names) {
      names = new Set();
      falconRegistered.set(api, names);
    }
    if (!names.has(name)) {
      const definition = createFalconEditorTheme(family);
      if (!definition) return mode === "dark" ? "vs-dark" : "vs";
      api.defineTheme(name, definition);
      names.add(name);
    }
    return name;
  }
  if (family !== "catppuccin") return mode === "dark" ? "vs-dark" : "vs";
  if (!registered.has(api)) {
    api.defineTheme("openagent-latte", createCatppuccinEditorTheme("light"));
    api.defineTheme("openagent-mocha", createCatppuccinEditorTheme("dark"));
    registered.add(api);
  }
  return mode === "dark" ? "openagent-mocha" : "openagent-latte";
}
