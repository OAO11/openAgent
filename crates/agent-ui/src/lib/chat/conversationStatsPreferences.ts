import { useMemo, useSyncExternalStore } from "react";

export const CONVERSATION_STAT_KEYS = [
  "turns",
  "steps",
  "context",
  "llmTime",
  "toolTime",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheHit",
  "ttft",
  "throughput",
] as const;
export type ConversationStatKey = (typeof CONVERSATION_STAT_KEYS)[number];
export type ConversationStatsVisibility = Record<ConversationStatKey, boolean>;
export const CONVERSATION_STATS_STORAGE_KEY = "openagent.conversationStats.visibility.v1";
const CHANGE_EVENT = "openagent:conversation-stats-visibility";
let fallback: string | null = null;

export function normalizeConversationStatsVisibility(raw: unknown): ConversationStatsVisibility {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    CONVERSATION_STAT_KEYS.map((key) => [key, source[key] !== false]),
  ) as ConversationStatsVisibility;
}

function snapshot(): string | null {
  try {
    return window.localStorage.getItem(CONVERSATION_STATS_STORAGE_KEY);
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONVERSATION_STATS_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function useConversationStatsVisibility() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const visible = useMemo(() => {
    try {
      return normalizeConversationStatsVisibility(raw ? JSON.parse(raw) : null);
    } catch {
      return normalizeConversationStatsVisibility(null);
    }
  }, [raw]);
  const save = (next: ConversationStatsVisibility) => {
    fallback = JSON.stringify(next);
    try {
      window.localStorage.setItem(CONVERSATION_STATS_STORAGE_KEY, fallback);
    } catch {
      /* Session-only if storage is unavailable. */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return { visible, save };
}
