import palettes from "./falcon.json";
import { getFalconTheme } from "./falconCatalog";

export function getFalconPalette(id: unknown) {
  const theme = getFalconTheme(id);
  return theme ? palettes[theme.id] : undefined;
}
