import { useSyncExternalStore } from "react";
import {
  readDocumentAppearanceKey,
  readDocumentColorTheme,
  subscribeDocumentAppearance,
} from "./documentTheme";

export function useDocumentAppearance() {
  return useSyncExternalStore(
    subscribeDocumentAppearance,
    readDocumentAppearanceKey,
    () => "default:light",
  );
}

export function useDocumentColorTheme() {
  return useSyncExternalStore(
    subscribeDocumentAppearance,
    readDocumentColorTheme,
    () => "default" as const,
  );
}
