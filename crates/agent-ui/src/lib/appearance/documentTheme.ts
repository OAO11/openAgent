import type { ColorTheme, EffectiveTheme } from "../settings/types";
import { getFalconTheme } from "./falconCatalog";

export function readDocumentColorTheme(): ColorTheme {
  const value =
    typeof document !== "undefined" ? document.documentElement.dataset?.colorTheme : undefined;
  return getFalconTheme(value)?.id ?? (value === "catppuccin" ? "catppuccin" : "default");
}

export function readDocumentThemeMode(): EffectiveTheme {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

export function readDocumentAppearanceKey(): string {
  return `${readDocumentColorTheme()}:${readDocumentThemeMode()}`;
}

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;

/** One observer covers mode and palette changes, including already mounted embedded views. */
export function subscribeDocumentAppearance(listener: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  listeners.add(listener);
  if (!observer) {
    let current = readDocumentAppearanceKey();
    observer = new MutationObserver(() => {
      const next = readDocumentAppearanceKey();
      if (next === current) return;
      current = next;
      for (const notify of listeners) notify();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-color-theme"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}
