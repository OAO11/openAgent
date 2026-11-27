// Synthetic workload: open 40 distinct 256 KiB subagent transcripts, then close
// the pane. No provider, API key or user conversation is used.
import { createTsModuleLoader } from '../test/helpers/load-ts-module.mjs';
const store = createTsModuleLoader().loadModule('src/lib/subagents/kbrainSubagentStore.ts');
const subagent = id => ({ id, parent_id: 'session', description: id, status: 'done', model: {provider:'fixture',model:'fixture'}, parent_tool_call_id:id, started_at:'2026-11-27T00:00:00Z' });
store.configureKBrainSubagentStore({ resolveSession: () => 'session', client: () => ({
  getSubagentTranscript: async (_session, id) => ({ subagent: subagent(id), last_seq: 1, live: false, messages: [{role:'assistant',content:[{type:'text',text:JSON.parse(JSON.stringify(id + 'x'.repeat(256 * 1024 - id.length)))}]}] }),
}) });
const retained = () => Object.values(store.getKBrainConversationSubagents('bench')?.entries ?? {}).reduce((sum, entry) => sum + (entry.transcript?.messages ?? []).reduce((n,m) => n + (m.content ?? []).reduce((k,b) => k+(b.text?.length ?? 0),0),0), 0);
globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const started = performance.now();
for (let i=0;i<40;i++) {
  const id=`task-${i}`;
  store.ingestKBrainSubagentEvent('bench','session',{version:'kbrain.agent.v1',seq:1,conversation_id:'session',run_id:'run',type:'subagent.completed',created_at:'2026-11-27T00:00:00Z',payload:{subagent:subagent(id)}});
  await store.loadKBrainSubagentTranscript('bench',id);
  store.openKBrainSubagent('bench',id);
}
globalThis.gc?.();
const opened = {retainedTextBytes: retained(), heapGrowth:process.memoryUsage().heapUsed-heapBefore};
store.closeKBrainSubagentPane('bench');
globalThis.gc?.();
console.log(JSON.stringify({opened,closed:{retainedTextBytes:retained(),heapGrowth:process.memoryUsage().heapUsed-heapBefore},elapsedMs:performance.now()-started}));
store.resetKBrainSubagentStore();