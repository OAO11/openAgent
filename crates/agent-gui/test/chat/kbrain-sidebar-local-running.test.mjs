import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// Consolidates the desktop assertions formerly mixed with retired Gateway publication tests.
function fixture(t) {
  let configuration;
  const loader = createTsModuleLoader({ mocks: {
    "@liveagent/app/shims/tauriCore": { invoke: async () => { throw new Error("Local sidebar must not publish to Gateway"); } },
    "./client": { createKBrainClient: () => ({}) },
    "./history": { summaryForSession: (session, id) => ({ id, title: session.title, sessionId: session.id, createdAt: 1, updatedAt: 2, providerId: "fixture", model: "test", messageCount: 2 }) },
    "./sessionSync": { createKBrainSessionSync: (options) => {
      configuration = options;
      return { isHealthy: () => true, restart() {}, acquire: () => () => {}, getSnapshot: () => undefined, waitForRevision: async () => {} };
    } },
    "./sessionSyncState": { setKBrainMutationSync() {} },
  } });
  const { kBrainSidebarSync: sync } = loader.loadModule("src/lib/kbrain/sidebarSync.ts");
  const mapping = loader.loadModule("src/lib/kbrain/mapping.ts");
  t.after(sync.subscribe(() => {}));
  const snapshot = (sessions, extra = {}) => configuration.onSnapshot({ epoch: "e", revision: "1", sessions: new Map(sessions.map(s => [s.id, s])), workdirs: [], ...extra });
  const change = (changes) => configuration.onChanges({ epoch: "e", revision: "2", changes, workdirs: [] });
  const list = () => sync.list(1, 50, { kind: "all" }).items;
  const row = (id) => list().find(item => item.id === id);
  snapshot([{ id: "listed", title: "Earlier chat" }]);
  configuration.onHealth(true);
  return { sync, mapping, snapshot, change, list, row };
}
const running = { id: "local-run", title: "New conversation", isPending: true, providerId: "fixture", model: "test", createdAt: 5, updatedAt: 6 };
function finish(f, id = running.id) {
  const previous = globalThis.setTimeout;
  const callbacks = [];
  globalThis.setTimeout = (callback, ms) => {
    if (ms >= 1000) { callbacks.push(callback); return 0; }
    return previous(callback, ms);
  };
  try { f.sync.clearRunning(id); } finally { globalThis.setTimeout = previous; }
  assert.equal(callbacks.length, 1, "unfinished persistence gets a grace timer");
  return callbacks[0];
}
function listRunning(f) {
  f.mapping.setKBrainSessionId(running.id, "backend-run");
  f.change([{ kind: "upsert", id: "backend-run", listed: true, session: { id: "backend-run", title: "Saved conversation" } }]);
}

test("a running conversation remains visible before K-brain lists its session", (t) => {
  const f = fixture(t);
  f.sync.markRunning(running);
  assert.equal(f.row(running.id)?.isPending, true);
  assert.equal(f.list().length, 2);
  f.mapping.setKBrainSessionId(running.id, "backend-run");
  f.change([{ kind: "upsert", id: "backend-run", listed: false, session: { id: "backend-run", title: "Not yet listed" } }]);
  assert.equal(f.row(running.id)?.title, running.title);
});
test("the authoritative K-brain row replaces the pending row and survives turn completion", (t) => {
  const f = fixture(t);
  f.sync.markRunning(running);
  listRunning(f);
  f.sync.clearRunning(running.id);
  assert.equal(f.row(running.id)?.title, "Saved conversation");
  assert.equal(f.row(running.id)?.isPending, undefined);
});
test("a finished turn keeps its row during persistence and yields to K-brain", (t) => {
  const f = fixture(t);
  f.sync.markRunning(running);
  finish(f);
  assert.equal(f.row(running.id)?.title, running.title);
  listRunning(f);
  assert.equal(f.row(running.id)?.title, "Saved conversation");
});
test("a never-saved turn disappears after the grace period", (t) => {
  const f = fixture(t);
  f.sync.markRunning(running);
  const expire = finish(f);
  assert.ok(f.row(running.id));
  expire();
  assert.equal(f.row(running.id), undefined);
});
test("a backend epoch snapshot retains the local running conversation", (t) => {
  const f = fixture(t);
  f.sync.markRunning(running);
  f.snapshot([{ id: "listed", title: "Earlier chat" }], { epoch: "replacement" });
  assert.ok(f.row(running.id));
  assert.equal(f.list().length, 2);
});
test("deleting a listed conversation during its old grace window cannot revive it", (t) => {
  const f = fixture(t);
  f.sync.markRunning(running);
  const expire = finish(f);
  listRunning(f);
  f.change([{ kind: "delete", id: "backend-run", listed: false }]);
  assert.equal(f.row(running.id), undefined);
  expire();
  assert.equal(f.row(running.id), undefined);
});
for (const mode of ["change", "resync"]) {
  for (const finished of [false, true]) {
    test(`deleting a never-listed ${finished ? "finished" : "running"} turn via ${mode} removes its row and alias`, (t) => {
      const f = fixture(t);
      f.sync.markRunning(running);
      f.mapping.setKBrainSessionId(running.id, "backend-run");
      const expire = finished ? finish(f) : undefined;
      if (mode === "change") f.change([{ kind: "delete", id: "backend-run", listed: false }]);
      else f.snapshot([{ id: "listed", title: "Earlier chat" }], { deletedSessionIds: ["backend-run"] });
      assert.equal(f.row(running.id), undefined);
      assert.equal(f.mapping.getKBrainSessionId(running.id), undefined);
      expire?.();
      assert.equal(f.row(running.id), undefined);
    });
  }
}
test("authoritative deletes release aliases while unlisted sessions retain them", (t) => {
  const f = fixture(t);
  f.snapshot([{ id: "deleted", title: "Deleted" }, { id: "hidden", title: "Hidden" }]);
  const hiddenAlias = f.mapping.getKBrainConversationId("hidden");
  assert.ok(hiddenAlias);
  f.snapshot([], { deletedSessionIds: ["deleted"] });
  assert.equal(f.mapping.getKBrainConversationId("deleted"), undefined);
  assert.equal(f.mapping.getKBrainConversationId("hidden"), hiddenAlias);
  assert.deepEqual(f.list(), []);
});
