import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

let picker;
const env = await createDomTestEnv({ mocks: {
  "@liveagent/ui/components/IconSet": new Proxy({}, { get: () => () => null }),
  [fileURLToPath(new URL("../../../agent-ui/src/pages/settings/modelPicker.tsx", import.meta.url))]: {
    ModelPicker: (props) => { picker = props; return null; },
  },
}});
after(() => env.cleanup());
const { React, act, loadModule } = env;
const { normalizeSettings } = loadModule("src/lib/settings/index.ts");
const { ResourceTranslationProvider, ResourceTranslationControls, useResourceTranslation } =
  loadModule("@liveagent/ui/components/resources/ResourceTranslation.tsx");
const { AgentPromptTemplateModal } = loadModule("@liveagent/ui/pages/settings/AgentPromptTemplateModal.tsx");
const { t } = loadModule("src/i18n/config.ts");
const provider = (id, enabled = true) => ({
  id, name: id, type: "codex", enabled, baseUrl: "https://fixture.invalid", apiKey: "",
  models: [{ id: "shared", contextWindow: 200000, maxOutputToken: 8192 }], activeModels: ["shared"],
});
function fixture(providers) {
  return normalizeSettings({ locale: "zh-CN", customProviders: providers,
    selectedModel: { customProviderId: "a", model: "shared" } });
}
function mount() {
  const host = document.body.appendChild(document.createElement("div"));
  const root = env.createRoot(host);
  return { render: async (node) => act(async () => root.render(node)),
    close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const button = (key) => [...document.querySelectorAll("button")].find(el => el.textContent === t(key));
let translation;
function TranslationView() {
  translation = useResourceTranslation({ example: "Explain the resource." });
  return React.createElement(ResourceTranslationControls, { translation });
}

test("translation excludes disabled providers and disables translation without an available model", async () => {
  const view = mount();
  const calls = [];
  const translate = async (input) => { calls.push(input); throw new Error("fixture"); };
  const render = (providers) => view.render(React.createElement(ResourceTranslationProvider,
    { settings: fixture(providers), resourceHost: { translate } }, React.createElement(TranslationView)));
  try {
    await render([provider("a", false)]);
    assert.equal(document.querySelector("select").disabled, true);
    assert.equal(button("resourceTranslation.Start").disabled, true);
    await act(async () => translation.translate());
    assert.equal(calls.length, 0);
    await render([provider("a", false), provider("b")]);
    assert.deepEqual([...document.querySelectorAll("select option")].map(el => el.value), [JSON.stringify(["b", "shared"])]);
    assert.equal(document.querySelector("select").value, JSON.stringify(["b", "shared"]));
    assert.equal(button("resourceTranslation.Start").disabled, false);
  } finally { await view.close(); }
});

test("disabling a translation provider cancels its request and replaces the stale selection", async () => {
  const view = mount();
  let request;
  let finish;
  let operation;
  const translate = (input, signal) => { request = { input, signal }; return new Promise(resolve => { finish = resolve; }); };
  const render = (providers) => view.render(React.createElement(ResourceTranslationProvider,
    { settings: fixture(providers), resourceHost: { translate } }, React.createElement(TranslationView)));
  try {
    await render([provider("a"), provider("b")]);
    await act(async () => { operation = translation.translate(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(request.input.model.provider, "a");
    await render([provider("a", false), provider("b")]);
    assert.equal(request.signal.aborted, true);
    assert.equal(document.querySelector("select").value, JSON.stringify(["b", "shared"]));
    await act(async () => { finish("{}"); await operation; });
    assert.equal(translation.hasTranslations, false);
    await render([provider("a"), provider("b")]);
    assert.equal(document.querySelector("select").value, JSON.stringify(["b", "shared"]));
    await render([provider("a", false), provider("b", false)]);
    assert.equal(button("resourceTranslation.Start").disabled, true);
  } finally {
    if (finish) { await act(async () => { finish("{}"); await operation; }); }
    await view.close();
  }
});

test("role model picker rejects disabled saved models and allows choosing inheritance or an enabled provider", async () => {
  const view = mount();
  const saved = [];
  const initialData = { id: "role", name: "Architect", prompt: "Design the system.", enabled: true,
    roleEnabled: true, roleProviderId: "a", roleModelId: "shared" };
  const render = (providers) => view.render(React.createElement(AgentPromptTemplateModal, {
    initialData, providers: fixture(providers).customProviders, onSave: data => saved.push(data), onClose() {},
  }));
  try {
    await render([provider("a", false), provider("b")]);
    assert.deepEqual(picker.options.map(option => option.providerId), ["b"]);
    assert.equal(button("settings.save").disabled, true);
    assert.ok(document.querySelector('[role="alert"]'));
    await act(async () => button("settings.save").click());
    assert.equal(saved.length, 0);
    await act(async () => picker.onChange(JSON.stringify(["b", "shared"])));
    assert.equal(button("settings.save").disabled, false);
    await act(async () => button("settings.save").click());
    assert.equal(saved[0].roleProviderId, "b");
    await render([provider("a", false), provider("b", false)]);
    assert.equal(button("settings.save").disabled, true);
    await act(async () => picker.onChange(""));
    assert.equal(button("settings.save").disabled, false);
    await act(async () => button("settings.save").click());
    assert.equal(saved[1].roleProviderId, undefined);
    assert.equal(saved[1].roleModelId, undefined);
  } finally { await view.close(); }
});
