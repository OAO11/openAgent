import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";
let vm;
let fetched = [];
const saved = [];
const env = await createDomTestEnv({ mocks: {
 [fileURLToPath(new URL("../../../agent-ui/src/pages/settings/ProviderModalView.tsx", import.meta.url))]: { ProviderModalView: ({viewModel}) => { vm = viewModel; return null; } },
 "@liveagent/adapters/providerSettings": { providerCredentialsRedacted: true, revealStoredProviderApiKey: async () => "", discoverProviderModels: async () => fetched },
 "@liveagent/ui/i18n/index": { useLocale: () => ({t: (key) => key}) },
 "@liveagent/app/lib/providers/usageQuery": { testProviderUsage: async () => null },
 "@liveagent/ui/lib/models/thinkingLive": { loadThinkingLiveSupplement: async () => {} },
 "../../src-tauri/icons/custom/ccswitch.png": { default: "ccswitch.png" },
 "../../src-tauri/icons/custom/cherrystudio.png": { default: "cherrystudio.png" },
}});
const { ProviderModal } = env.loadModule("@liveagent/ui/pages/settings/ProviderModal.tsx");
const model = { id: "first", contextWindow: 200000, maxOutputToken: 8192, limitsSource: "provider" };
const provider = { id:"relay", name:"Relay", type:"claude_code", enabled:false, baseUrl:"https://fixture.invalid", apiKey:"", apiKeyConfigured:true, models:[model,{...model,id:"active"}], activeModels:["active"] };

test("parameter panel auto-selects, keeps drafts across selection and save, and retains 1M opt-in", async () => {
 const root=env.createRoot(document.body.appendChild(document.createElement("div")));
 await env.act(async () => root.render(env.React.createElement(ProviderModal,{providerType:"claude_code",initialData:provider,onSave:(data)=>saved.push(data),onClose:()=>{}})));
 try {
  assert.equal(vm.editingModel.model.id,"active");
  assert.equal(vm.editingModel.contextWindow,"200000");
  await env.act(async () => vm.setEditingModel(draft=>({...draft,maxOutputToken:"16384"})));
  await env.act(async () => vm.openModelSettings("first"));
  await env.act(async () => vm.openModelSettings("active"));
  assert.equal(vm.editingModel.maxOutputToken,"16384");
  await env.act(async () => vm.setModel1M("active",true));
  assert.equal(vm.editingModel.contextWindow,"1000000");
  await env.act(async () => vm.saveInlineModelSettings());
  assert.equal(vm.editingModel.model.id,"active");
  await env.act(async () => vm.handleSave());
  assert.equal(saved.length,1);
  assert.equal(saved[0].enabled,false);
  assert.equal(saved[0].models.find(m=>m.id==="active").supports1M,true);
  assert.equal(saved[0].models.find(m=>m.id==="active").maxOutputToken,16384);
  await env.act(async () => vm.removeModel("active"));
  assert.equal(vm.editingModel.model.id,"first");
 } finally { await env.act(async()=>root.unmount()); }
});

test("discovery fills an empty parameter panel and refreshes untouched parameters without losing edits", async () => {
 const root=env.createRoot(document.body.appendChild(document.createElement("div")));
 await env.act(async () => root.render(env.React.createElement(ProviderModal,{providerType:"claude_code",initialData:{...provider,models:[],activeModels:[]},onSave:()=>{},onClose:()=>{}})));
 try {
  assert.equal(vm.editingModel,null);
  fetched=[model];await env.act(async()=>vm.handleRefresh());
  assert.equal(vm.editingModel.model.id,"first");
  fetched=[{...model,contextWindow:300000}];await env.act(async()=>vm.handleRefresh());
  assert.equal(vm.editingModel.contextWindow,"300000");
  await env.act(async()=>vm.setEditingModel(draft=>({...draft,contextWindow:"400000"})));
  fetched=[{...model,contextWindow:500000}];await env.act(async()=>vm.handleRefresh());
  assert.equal(vm.editingModel.contextWindow,"400000");
 } finally { await env.act(async()=>root.unmount()); }
});
