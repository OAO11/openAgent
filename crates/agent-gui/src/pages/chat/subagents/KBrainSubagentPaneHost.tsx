import { SubagentPane, SubagentRunningChip } from "@liveagent/ui/components/subagents/SubagentPane";
import type { SubagentView } from "@liveagent/ui/contracts/subagentPane";
import { useLocale } from "@liveagent/ui/i18n/index";
import type { ChatFileLink } from "@liveagent/ui/lib/chat/chatFileLinks";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createKBrainPromptClient } from "../../../lib/kbrain/prompts";
import { subagentDirectory } from "../../../lib/subagents/kbrainPane";
import {
  closeKBrainSubagentPane,
  closeKBrainSubagentTab,
  countRunningKBrainSubagents,
  getKBrainConversationSubagents,
  loadKBrainSubagents,
  loadKBrainSubagentTranscript,
  openKBrainSubagent,
  releaseKBrainSubagentTranscripts,
  showKBrainSubagentDirectory,
  stopKBrainSubagent,
  subscribeKBrainSubagents,
} from "../../../lib/subagents/kbrainSubagentStore";
import { subagentTranscriptItems } from "../../../lib/subagents/kbrainSubagentTranscript";
import { kbrainSubagentView } from "../../../lib/subagents/kbrainSubagentView";

function useConversationSubagents(conversationId: string) {
  return useSyncExternalStore(subscribeKBrainSubagents, () =>
    getKBrainConversationSubagents(conversationId),
  );
}

/**
 * The subagent side pane of one K-brain conversation. Mounting it also loads the
 * conversation's subagents, so cards in reloaded history find theirs.
 */
export function KBrainSubagentPaneHost({
  conversationId,
  workdir,
  onOpenFileLink,
}: {
  conversationId: string;
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const state = useConversationSubagents(conversationId);
  const [pages, setPages] = useState(1);
  useEffect(() => {
    setPages(1);
    void loadKBrainSubagents(conversationId);
    return () => releaseKBrainSubagentTranscripts(conversationId);
  }, [conversationId]);

  const entries = state?.entries;
  const pane = state?.pane;
  const tabs = useMemo(() => {
    const views: SubagentView[] = [];
    for (const id of pane?.tabs ?? []) {
      const entry = entries?.[id];
      if (entry) views.push(kbrainSubagentView(entry));
    }
    return views;
  }, [entries, pane?.tabs]);
  const directory = useMemo(() => {
    const listed = subagentDirectory(
      Object.values(entries ?? {}).map((entry) => entry.subagent),
      pages,
    );
    const view = (id: string) => {
      const entry = entries?.[id];
      return entry ? [kbrainSubagentView(entry)] : [];
    };
    return {
      running: listed.running.flatMap((subagent) => view(subagent.id)),
      ended: listed.ended.flatMap((subagent) => view(subagent.id)),
      endedTotal: listed.endedTotal,
      hasMoreEnded: listed.hasMoreEnded,
    };
  }, [entries, pages]);
  const activeEntry = pane?.active ? entries?.[pane.active] : undefined;
  const activeTranscript = activeEntry?.transcript;
  useEffect(() => {
    if (pane?.open && pane.active && !activeTranscript) {
      void loadKBrainSubagentTranscript(conversationId, pane.active);
    }
  }, [conversationId, pane?.open, pane?.active, activeTranscript]);
  const live = activeEntry ? kbrainSubagentView(activeEntry).status === "running" : false;
  const transcript = useMemo(() => {
    if (!activeTranscript) return undefined;
    return {
      status: activeTranscript.status,
      ...(activeTranscript.error ? { error: activeTranscript.error } : {}),
      items:
        activeTranscript.status === "ready"
          ? subagentTranscriptItems(activeTranscript.messages, live)
          : [],
    };
  }, [activeTranscript, live]);

  if (!state || !pane?.open) return null;
  return (
    <SubagentPane
      tabs={tabs}
      activeId={pane.active}
      directory={directory}
      transcript={transcript}
      unsupported={state.unsupported}
      listStatus={state.listStatus}
      directoryHeader={
        <RoleAvailability
          key={conversationId}
          conversationId={conversationId}
          workdir={workdir}
          listFailed={state.listStatus === "error"}
        />
      }
      workdir={workdir}
      onShowDirectory={() => showKBrainSubagentDirectory(conversationId)}
      onSelectTab={(id) => openKBrainSubagent(conversationId, id)}
      onCloseTab={(id) => closeKBrainSubagentTab(conversationId, id)}
      onClose={() => closeKBrainSubagentPane(conversationId)}
      onShowMore={() => setPages((value) => value + 1)}
      onStop={(id) => stopKBrainSubagent(conversationId, id)}
      onRetryTranscript={(id) => void loadKBrainSubagentTranscript(conversationId, id)}
      onOpenFileLink={onOpenFileLink}
    />
  );
}

/** "{count} running" beside the composer's task progress; opens the directory. */
export function KBrainSubagentRunningChip({ conversationId }: { conversationId: string }) {
  const state = useConversationSubagents(conversationId);
  return (
    <SubagentRunningChip
      count={countRunningKBrainSubagents(state)}
      total={state?.order.length ?? 0}
      listStatus={state?.listStatus ?? "idle"}
      unsupported={state?.unsupported}
      onOpen={() => showKBrainSubagentDirectory(conversationId)}
    />
  );
}

function RoleAvailability({
  conversationId,
  workdir,
  listFailed,
}: {
  conversationId: string;
  workdir?: string;
  listFailed: boolean;
}) {
  const { t } = useLocale();
  const [roles, setRoles] = useState<{ names: string[]; status: "loading" | "ready" | "error" }>({
    names: [],
    status: "loading",
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const current = ++request;
      setRoles({ names: [], status: "loading" });
      try {
        const snapshot = await createKBrainPromptClient().get(workdir);
        if (active && current === request)
          setRoles({
            status: "ready",
            names: snapshot.globalTemplates
              .filter((item) => item.roleEnabled)
              .map((item) => item.name),
          });
      } catch {
        if (active && current === request) setRoles({ names: [], status: "error" });
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, [workdir, revision]);
  return (
    <div
      data-subagent-role-availability=""
      className="space-y-2 border-b border-border/60 px-4 py-3 text-xs text-foreground/65"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{t("chat.subagent.conversationScope")}</span>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setRevision((value) => value + 1);
            void loadKBrainSubagents(conversationId);
          }}
        >
          {t("chat.subagent.refresh")}
        </button>
      </div>
      {listFailed ? (
        <p role="status" className="text-destructive">
          {t("chat.subagent.listError")}
        </p>
      ) : null}
      <p>
        {roles.status === "loading"
          ? t("chat.subagent.rolesLoading")
          : roles.status === "error"
            ? t("chat.subagent.rolesError")
            : t("chat.subagent.rolesAvailable").replace("{count}", String(roles.names.length))}
      </p>
      {roles.status === "ready" && roles.names.length > 0 ? (
        <p className="break-words">{roles.names.join(" · ")}</p>
      ) : null}
      <p>{t("chat.subagent.roleExplanation")}</p>
    </div>
  );
}
