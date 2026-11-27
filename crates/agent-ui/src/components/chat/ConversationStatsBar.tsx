import { useLocale } from "@liveagent/ui/i18n/index";
import { useDocumentHidden } from "@liveagent/ui/lib/shared/documentVisibility";
import { useEffect, useState } from "react";
import { canManualCompact, contextUsageRatio } from "../../lib/chat/contextUsage";
import {
  CONVERSATION_STAT_KEYS,
  type ConversationStatKey,
  normalizeConversationStatsVisibility,
  useConversationStatsVisibility,
} from "../../lib/chat/conversationStatsPreferences";
import {
  type ConversationStats,
  EMPTY_CONVERSATION_STATS,
  formatStatCount,
  formatStatDuration,
  formatStatLatency,
  formatStatPercent,
  formatStatThroughput,
  formatStatTokens,
  hasConversationStats,
  resolveStatDurations,
} from "../../lib/trajectory/stats";
import { Settings2 } from "../IconSet";
import { ConfirmActionPopover } from "../ui/confirm-action-popover";
import { LabelTooltip } from "../ui/label-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { RollingStatText } from "./RollingStatText";

const HEARTBEAT_MS = 1_000;
function useRunningHeartbeat(running: boolean): number {
  const hidden = useDocumentHidden();
  const [, setBeat] = useState(0);
  useEffect(() => {
    if (!running || hidden) return;
    const timer = setInterval(() => setBeat((beat) => beat + 1), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [hidden, running]);
  return Date.now();
}

type StatMetric = { key: ConversationStatKey; label: string; value: string; short: string };

/** Selected metrics wrap instead of disappearing as the workbench narrows. */
export function ConversationStatsBar(props: {
  stats: ConversationStats | null;
  onManualCompactConfirm?: (() => void) | (() => Promise<unknown>);
  manualCompactBlocked?: boolean;
  contextUsageTokens?: number;
  contextWindow?: number;
}) {
  const { t, locale } = useLocale();
  const { visible, save } = useConversationStatsVisibility();
  const stats = props.stats ?? EMPTY_CONVERSATION_STATS;
  const hasStats = hasConversationStats(props.stats);
  const running = stats.llmRunningSinceAt !== null || stats.toolRunningSinceAt !== null;
  const now = useRunningHeartbeat(running);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const ratio = contextUsageRatio(props.contextUsageTokens, props.contextWindow);
  const hasContext =
    typeof props.contextWindow === "number" &&
    Number.isFinite(props.contextWindow) &&
    props.contextWindow > 0;
  const compactAvailable =
    canManualCompact(ratio) && !props.manualCompactBlocked && Boolean(props.onManualCompactConfirm);
  if (!compactAvailable && confirmOpen) setConfirmOpen(false);
  const durations = resolveStatDurations(stats, now);
  const fill = (key: string, token: string, value: string) => t(key).replace(token, value);
  const tokens = (key: ConversationStatKey, value: number): StatMetric => ({
    key,
    label: t(`chat.stats.${key}Label`),
    value: fill("chat.stats.tokenValue", "{n}", formatStatTokens(value, locale)),
    short: fill(`chat.stats.${key}Short`, "{n}", formatStatTokens(value, locale)),
  });
  const metrics: StatMetric[] = [
    {
      key: "turns",
      label: t("chat.stats.turnsLabel"),
      value: formatStatCount(stats.turns, locale),
      short: fill("chat.stats.turns", "{n}", formatStatCount(stats.turns, locale)),
    },
    {
      key: "steps",
      label: t("chat.stats.stepsLabel"),
      value: formatStatCount(stats.steps, locale),
      short: fill("chat.stats.steps", "{n}", formatStatCount(stats.steps, locale)),
    },
    {
      key: "context",
      label: t("chat.stats.contextUsageLabel"),
      value: !hasContext ? "—" : `${formatStatPercent(ratio)}%`,
      short: fill("chat.stats.contextUsage", "{p}", !hasContext ? "—" : formatStatPercent(ratio)),
    },
    {
      key: "llmTime",
      label: t("chat.stats.llmTimeLabel"),
      value: formatStatDuration(durations.llmMs),
      short: fill("chat.stats.llmTime", "{t}", formatStatDuration(durations.llmMs)),
    },
    {
      key: "toolTime",
      label: t("chat.stats.toolTimeLabel"),
      value: formatStatDuration(durations.toolMs),
      short: fill("chat.stats.toolTime", "{t}", formatStatDuration(durations.toolMs)),
    },
    tokens("inputTokens", stats.inputTokens),
    tokens("outputTokens", stats.outputTokens),
    tokens("cacheReadTokens", stats.cacheReadTokens ?? 0),
    tokens("cacheWriteTokens", stats.cacheWriteTokens ?? 0),
    {
      key: "cacheHit",
      label: t("chat.stats.cacheHitLabel"),
      value: stats.cacheHitRatio === null ? "—" : `${formatStatPercent(stats.cacheHitRatio)}%`,
      short: fill(
        "chat.stats.cacheHit",
        "{p}",
        stats.cacheHitRatio === null ? "—" : formatStatPercent(stats.cacheHitRatio),
      ),
    },
    {
      key: "ttft",
      label: t("chat.stats.ttftAvgLabel"),
      value: stats.ttftAvgMs === null ? "—" : formatStatLatency(stats.ttftAvgMs),
      short: fill(
        "chat.stats.ttftAvg",
        "{t}",
        stats.ttftAvgMs === null ? "—" : formatStatLatency(stats.ttftAvgMs),
      ),
    },
    {
      key: "throughput",
      label: t("chat.stats.throughputLabel"),
      value: stats.decodeTokPerSec === null ? "—" : formatStatThroughput(stats.decodeTokPerSec),
      short: fill(
        "chat.stats.throughput",
        "{n}",
        stats.decodeTokPerSec === null ? "—" : formatStatThroughput(stats.decodeTokPerSec),
      ),
    },
  ];
  const selected = metrics.filter((metric) => visible[metric.key]);
  const prefix = stats.approximate ? `${t("chat.stats.approximate")} ` : "";
  const fullText = hasStats
    ? prefix +
      selected.map((metric) => `${metric.label} ${metric.value}`).join(t("format.groupSeparator"))
    : t("chat.stats.empty");
  const tooltip = (
    <span className="flex flex-col gap-2 text-xs">
      <span className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        {metrics.map((metric) => (
          <span key={metric.key} className="contents">
            <span className="text-muted-foreground">{metric.label}</span>
            <span className="text-right tabular-nums">{metric.value}</span>
          </span>
        ))}
      </span>
      {stats.compactions > 0 && (
        <span>{fill("chat.stats.compactionsValue", "{n}", String(stats.compactions))}</span>
      )}
      <span className="max-w-72 border-t pt-2 font-normal">{t("chat.stats.inputTokensHint")}</span>
      {stats.approximate && <span>{t("chat.stats.approximateHint")}</span>}
      {compactAvailable && <span>{t("chat.manualCompactTitle")}</span>}
    </span>
  );
  const row = (
    <span
      aria-hidden="true"
      className="flex min-w-0 flex-wrap items-center justify-start gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground tabular-nums"
    >
      {prefix && <span className="inline-flex min-h-6 items-center">{prefix}</span>}
      {selected.map((metric) => (
        <span
          key={metric.key}
          data-stat={metric.key}
          className="inline-flex min-h-6 items-center whitespace-nowrap"
        >
          <RollingStatText text={metric.short} />
        </span>
      ))}
    </span>
  );
  return (
    <div
      data-conversation-stats
      className="relative flex min-h-7 w-full items-start justify-center gap-2 px-2 py-1"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-8 bottom-0 -z-10 bg-background/85 backdrop-blur-md"
      />
      <div
        role="status"
        aria-live="off"
        aria-label={fullText}
        className="flex min-w-0 flex-1 flex-col"
      >
        {!hasStats ? (
          <span className="block text-center text-xs leading-5 text-muted-foreground">
            {t("chat.stats.empty")}
          </span>
        ) : (
          <LabelTooltip label={tooltip} contentClassName="max-w-none">
            {compactAvailable ? (
              <ConfirmActionPopover
                title={t("chat.manualCompactTitle")}
                description={t("chat.manualCompactDescription")}
                confirmLabel={t("chat.manualCompactConfirm")}
                tone="default"
                side="top"
                align="center"
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                onConfirm={() => void props.onManualCompactConfirm?.()}
              >
                {(open) => (
                  <button
                    type="button"
                    onClick={open}
                    aria-label={t("chat.manualCompactTitle")}
                    className="block w-full rounded px-1 outline-hidden hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row}
                  </button>
                )}
              </ConfirmActionPopover>
            ) : (
              row
            )}
          </LabelTooltip>
        )}
      </div>
      <Popover>
        <PopoverTrigger
          aria-label={t("chat.stats.configure")}
          title={t("chat.stats.configure")}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings2 className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-64 p-3">
          <p className="mb-2 text-sm font-medium">{t("chat.stats.configure")}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {CONVERSATION_STAT_KEYS.map((key) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={visible[key]}
                  onChange={(event) => save({ ...visible, [key]: event.target.checked })}
                  className="size-3.5 accent-primary"
                />
                {metrics.find((metric) => metric.key === key)?.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="mt-3 text-xs text-muted-foreground underline hover:text-foreground"
            onClick={() => save(normalizeConversationStatsVisibility(null))}
          >
            {t("chat.stats.reset")}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
