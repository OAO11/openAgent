import { sortSidebarConversations } from "@liveagent/ui/lib/sidebar/reconcile";
import { conversationMatchesScope } from "@liveagent/ui/lib/sidebar/scope";
import type {
  SidebarBackendEvent,
  SidebarConversation,
  SidebarScope,
  SidebarWorkdirSummary,
} from "@liveagent/ui/lib/sidebar/types";
import { sameExternalRun } from "@liveagent/ui/lib/sidebar/types";
import { createKBrainClient } from "./client";
import { summaryForSession } from "./history";
import {
  clearKBrainSessionId,
  ensureKBrainConversationId,
  getKBrainConversationId,
  kBrainStorageScope,
  withKBrainMappingBatch,
} from "./mapping";
import {
  getConfiguredKBrainConnection,
  subscribeKBrainRuntimeConnection,
} from "./runtimeConnection";
import { createKBrainSessionSync, type KBrainSessionSyncSnapshot } from "./sessionSync";
import { setKBrainMutationSync } from "./sessionSyncState";
import type { KBrainSessionChange } from "./types";

const events = new Set<(event: SidebarBackendEvent) => void>();
const healthListeners = new Set<() => void>();
const connections = new Set<(healthy: boolean) => void>();
let items: SidebarConversation[] = [];
let workdirs: SidebarWorkdirSummary[] = [];
let owners = 0;
let release: (() => void) | undefined;
let unsubscribeConnection: (() => void) | undefined;
let focusTimer: ReturnType<typeof setTimeout> | undefined;
let identity = "";
let sourceId = "";
let backendEpoch = "";
let desired = new Map<string, SidebarConversation>();
// Conversations a desktop turn is running that K-brain has not listed yet: K-brain lists a
// session once its first message is saved, so a turn waiting on an approval would have no
// row and a WebUI could neither open it nor answer. They are served until K-brain lists them.
const running = new Map<string, SidebarConversation>();
// K-brain lists a finished turn's session a moment after the turn ends; dropping the row at
// turn end published a delete in between and a WebUI showing it went back home. A finished
// turn's row stays until K-brain lists it, or this long if it never does (stopped early).
const FINISHED_RUN_GRACE_MS = 60_000;
const finishing = new Map<string, ReturnType<typeof setTimeout>>();

// Once K-brain lists a conversation its row is authoritative: drop the running row and its
// grace timer, so a later delete publishes a delete instead of bringing the pending row back.
function releaseListedRunning() {
  for (const id of [...running.keys()]) if (desired.has(id)) dropRunning(id);
}

function dropRunning(id: string) {
  running.delete(id);
  const timer = finishing.get(id);
  if (timer !== undefined) clearTimeout(timer);
  finishing.delete(id);
}

function clearAllRunning() {
  for (const timer of finishing.values()) clearTimeout(timer);
  finishing.clear();
  running.clear();
}

function withRunning<T extends { id: string }>(
  listed: Iterable<[string, T]>,
  extra: Map<string, T>,
) {
  const out = new Map(listed);
  for (const [id, conversation] of extra) if (!out.has(id)) out.set(id, conversation);
  return out;
}
let lastFailure: string | undefined;

export function getKBrainSidebarSyncError(): string | undefined {
  return lastFailure;
}

// Debug automation reads the coordinator actually owned by the application,
// rather than importing a second Vite module instance. No tokens or paths.
if (import.meta.env?.DEV && typeof window !== "undefined") {
  Object.defineProperty(window, "__LIVEAGENT_SESSION_SYNC_DIAGNOSTICS__", {
    configurable: true,
    value: () => ({
      healthy: sync.isHealthy(),
      error: lastFailure ? "Session synchronization unavailable" : undefined,
      sessionCount: items.length,
      workdirsCount: workdirs.length,
      subscriberCount: owners,
      revision: sync.getSnapshot()?.revision,
      epoch: sync.getSnapshot()?.epoch,
    }),
  });
}

function updateHealth(healthy: boolean, error?: unknown) {
  lastFailure = error ? (error instanceof Error ? error.message : String(error)) : undefined;
  for (const listener of healthListeners) listener();
  for (const listener of connections) listener(healthy);
}

function sameConversation(a: SidebarConversation | undefined, b: SidebarConversation): boolean {
  return (
    !!a &&
    a.title === b.title &&
    a.updatedAt === b.updatedAt &&
    a.cwd === b.cwd &&
    a.model === b.model &&
    a.providerId === b.providerId &&
    a.messageCount === b.messageCount &&
    a.isPinned === b.isPinned &&
    a.pinnedAt === b.pinnedAt &&
    a.isShared === b.isShared &&
    a.sessionId === b.sessionId &&
    a.selectedModelJson === b.selectedModelJson &&
    a.createdAt === b.createdAt &&
    a.forkedFromSessionId === b.forkedFromSessionId &&
    sameExternalRun(a.externalRun, b.externalRun)
  );
}

function onSnapshot(snapshot: KBrainSessionSyncSnapshot) {
  if (backendEpoch && backendEpoch !== snapshot.epoch) {
  }
  backendEpoch = snapshot.epoch;
  items = withKBrainMappingBatch(() =>
    [...snapshot.sessions.values()].map((session) => {
      const id = ensureKBrainConversationId(session.id);
      const next = summaryForSession(session, id);
      const previous = desired.get(id);
      return previous && sameConversation(previous, next) ? previous : next;
    }),
  );
  workdirs = snapshot.workdirs.map((item) => ({
    path: item.cwd,
    conversationCount: item.count,
    updatedAt: Date.parse(item.updated_at) || 0,
  }));
  desired = new Map(items.map((item) => [item.id, item]));
  releaseListedRunning();
  const event: SidebarBackendEvent = {
    kind: "reset",
    conversations: items,
    workdirs,
    sourceIdentity: `${sourceId}\0${snapshot.epoch}`,
  };
  for (const listener of events) listener(event);
  withKBrainMappingBatch(() => {
    for (const backendId of snapshot.deletedSessionIds ?? []) {
      const id = getKBrainConversationId(backendId);
      if (!id) continue;
      clearKBrainSessionId(id);
      // Same as a delete change: a resync's deletes cover never-listed running rows too.
      dropRunning(id);
    }
  });
  // A bounded authoritative state can remove old browser aliases even if the
  // Gateway is disabled for the entire lifetime of the local deletion.
}

function onChanges(input: {
  epoch: string;
  revision: string;
  changes: ReadonlyArray<KBrainSessionChange>;
  workdirs: KBrainSessionSyncSnapshot["workdirs"];
}) {
  // A live batch is already validated by the coordinator. Apply only the
  // changed rows to the sidebar and keep the authoritative maps in sync. A
  // complete reset is reserved for initial load, epoch changes, and recovery.
  if (!backendEpoch || backendEpoch !== input.epoch) {
    return;
  }
  const nextDesired = new Map(desired);
  const nextItems = new Map(items.map((item) => [item.id, item]));
  const pendingEvents: SidebarBackendEvent[] = [];
  withKBrainMappingBatch(() => {
    for (const change of input.changes) {
      const backendId = change.id.trim();
      if (!backendId) continue;
      const conversationId = getKBrainConversationId(backendId);
      if (change.kind === "delete" || !change.listed) {
        if (!conversationId) continue;
        // K-brain keeps a new session unlisted until its first message is
        // persisted. Only rows that were listed have anything to delete; a
        // never-listed session must leave the local pending row in place.
        if (change.kind !== "delete" && !nextDesired.has(conversationId)) continue;
        nextDesired.delete(conversationId);
        nextItems.delete(conversationId);
        pendingEvents.push({ kind: "delete", conversationId, authoritative: true });
        if (change.kind === "delete") {
          clearKBrainSessionId(conversationId);
          // A delete is authoritative even for a session K-brain never listed: drop the
          // running row too, or the overlay would publish it again.
          dropRunning(conversationId);
        }
        continue;
      }
      const id = ensureKBrainConversationId(backendId);
      const next = summaryForSession(change.session, id);
      const previous = nextDesired.get(id);
      if (previous && sameConversation(previous, next)) continue;
      nextDesired.set(id, next);
      nextItems.set(id, next);
      pendingEvents.push({
        kind: "upsert",
        conversationId: id,
        conversation: next,
        authoritative: true,
      });
    }
  });
  desired = nextDesired;
  releaseListedRunning();
  items = [...nextItems.values()];
  workdirs = input.workdirs.map((item) => ({
    path: item.cwd,
    conversationCount: item.count,
    updatedAt: Date.parse(item.updated_at) || 0,
  }));
  for (const event of pendingEvents) for (const listener of events) listener(event);
  for (const listener of events) listener({ kind: "workdirs", workdirs });
}

const sync = createKBrainSessionSync({
  client: createKBrainClient(),
  onSnapshot,
  onChanges,
  onHealth: updateHealth,
});

function connectionIdentity() {
  const connection = getConfiguredKBrainConnection();
  return `${kBrainStorageScope()}\0${connection?.baseUrl ?? ""}\0${connection?.token ?? ""}`;
}

function changedConnection() {
  const next = connectionIdentity();
  if (next === identity) return;
  identity = next;
  sourceId = `kbrain:${kBrainStorageScope()}`;
  backendEpoch = "";
  desired = new Map();
  // Another backend: rows of runs against the previous one do not belong to it.
  clearAllRunning();
  items = [];
  workdirs = [];
  sync.restart();
}

function rescan() {
  if (globalThis.document?.visibilityState === "hidden" || focusTimer) return;
  focusTimer = setTimeout(() => {
    focusTimer = undefined;
    if (owners) sync.requestRescan();
  }, 150);
}

export const kBrainSidebarSync = {
  isHealthy: sync.isHealthy,
  subscribe(listener: (event: SidebarBackendEvent) => void) {
    events.add(listener);
    owners += 1;
    if (owners === 1) {
      changedConnection();
      setKBrainMutationSync({
        isHealthy: sync.isHealthy,
        reconcile: sync.restart,
        async confirm(id, epoch, revision) {
          try {
            await sync.waitForRevision(epoch, revision);
          } catch (error) {
            sync.restart();
            throw error;
          }
          return sync.getSnapshot()?.sessions.get(id);
        },
      });
      release = sync.acquire();
      unsubscribeConnection = subscribeKBrainRuntimeConnection(changedConnection);
      globalThis.addEventListener?.("focus", rescan);
      globalThis.document?.addEventListener("visibilitychange", rescan);
    } else if (sync.isHealthy()) listener({ kind: "reset", conversations: items, workdirs });
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      events.delete(listener);
      owners -= 1;
      if (!owners) {
        release?.();
        release = undefined;
        unsubscribeConnection?.();
        unsubscribeConnection = undefined;
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = undefined;
        globalThis.removeEventListener?.("focus", rescan);
        globalThis.document?.removeEventListener("visibilitychange", rescan);
        setKBrainMutationSync(undefined);
        items = [];
        workdirs = [];
        desired.clear();
      }
    };
  },
  subscribeHealth(listener: () => void) {
    healthListeners.add(listener);
    return () => {
      healthListeners.delete(listener);
    };
  },
  subscribeConnection(listener: (healthy: boolean) => void) {
    connections.add(listener);
    listener(sync.isHealthy());
    return () => {
      connections.delete(listener);
    };
  },
  list(page: number, pageSize: number, scope: SidebarScope) {
    const all = sortSidebarConversations(
      [
        ...withRunning(
          items.map((item) => [item.id, item]),
          running,
        ).values(),
      ].filter((item) => conversationMatchesScope(item, scope)),
    );
    return { items: all.slice((page - 1) * pageSize, page * pageSize), totalCount: all.length };
  },
  pinned: () => sortSidebarConversations(items.filter((item) => item.isPinned === true)),
  workdirs: () => workdirs,
  /** A desktop turn started this conversation; serve it until K-brain lists it. */
  markRunning(conversation: SidebarConversation) {
    const timer = finishing.get(conversation.id);
    if (timer !== undefined) clearTimeout(timer);
    finishing.delete(conversation.id);
    running.set(conversation.id, conversation);
  },
  /** The turn ended. A conversation K-brain lists keeps K-brain's row. */
  clearRunning(conversationId: string) {
    if (!running.has(conversationId) || finishing.has(conversationId)) return;
    if (desired.has(conversationId)) {
      running.delete(conversationId);
      return;
    }
    finishing.set(
      conversationId,
      setTimeout(() => {
        finishing.delete(conversationId);
        running.delete(conversationId);
      }, FINISHED_RUN_GRACE_MS),
    );
  },
};
