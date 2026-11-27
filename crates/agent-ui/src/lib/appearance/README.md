# Bundled theme sources

## Catppuccin

`catppuccin.json` contains the Latte and Mocha hex colors from Catppuccin palette
1.8.0, commit `07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`.
Source: https://github.com/catppuccin/palette

Copyright (c) 2021 Catppuccin. MIT licensed; the complete license is shipped in
`crates/agent-gui/public/third-party/catppuccin-LICENSE.txt`.

The openAgent semantic mapping, Monaco and Mermaid configurations are local
adaptations. Regenerate the CSS with `node scripts/generate-catppuccin-theme.mjs`.
Markdown uses the Catppuccin themes already distributed with Shiki.

## Falcon JetBrains themes

All 28 theme definitions (14 classic and 14 Islands) are adapted from
`https://github.com/panxiaoan/falcon-jetbrains-themes`, pinned revision
`c3ddba2d8c71137e5191033df8e882b2936f8f7d`. Copyright (c) 2024-Present
Falcon Relax Eyes Theme. The original MIT license is shipped as
`crates/agent-gui/public/third-party/falcon-LICENSE.txt`.

The source UI `.theme.json` colors and each referenced XML editor scheme are
converted to `falcon.json`, `falconCatalog.ts`, `styles/falcon.css` and the inline
boot theme allowlist/colors in `agent-gui/index.html`. `falcon-source.json`
records the exact source files and SHA-256 hashes. No upstream plugin code,
Gradle tasks, fonts or images are executed or bundled.

To regenerate, extract the archive at the pinned revision and run:

```powershell
python scripts/generate-falcon-themes.py PATH_TO_EXTRACTED_PINNED_REPOSITORY
node_modules/.bin/biome.cmd format --write crates/agent-ui/src/lib/appearance/falconCatalog.ts
```

This is a color adaptation to openAgent's layout, not the JetBrains Islands UI
engine. Islands themes use their separate `mainBackground` for outer/rail
surfaces. Editor background/caret/selection and syntax rules come from the XML;
terminal ANSI colors come from its console attributes. Derived semantic colors
and low-contrast text are adjusted for readability. The normal UI/editor/terminal
text meets 4.5:1; syntax and ANSI colors are adjusted to at least 3:1 against the
editor/terminal background. Theme labels are localized while original upstream
names remain in the catalog. There is no theme named Cyberpunk in this snapshot.

Falcon presets have a fixed native light/dark mode; selecting one persists that
mode and both boot and React resolve it consistently. Their mode shortcut opens
system settings to select another preset. Default and Catppuccin still allow
light/dark/system selection. Unknown IDs fall back to the default theme.
