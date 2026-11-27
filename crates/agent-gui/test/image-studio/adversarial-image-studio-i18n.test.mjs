import assert from "node:assert/strict";
import test from "node:test";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

// Adversarial review of the image studio i18n change. Real modules only: the settings
// parser, the controller, TargetParameterForm/ImageComposer and the WebUI host adapter.

const enumSpec = (key, values) => ({ key, label: key, type: "string", required: false, enum: values });
const caps = { operations: ["generate"], maxCount: 1, maxInputs: 16, outputFormats: ["png"], supportsCancel: true };
// K-brain direct.ProtocolProfile(OpenAIID) and direct.ModelParameters(GoogleID) shapes.
const openAI = {
  id: "it_openai", name: "moonup · gpt-image", enabled: true, revision: 1, capabilities: caps,
  parameters: [
    enumSpec("size", ["1024x1024", "1536x1024"]),
    enumSpec("quality", ["low", "medium", "high", "auto"]),
    enumSpec("background", ["opaque", "transparent", "auto"]),
  ],
};
const google = {
  id: "it_google", name: "gemini · image", enabled: true, revision: 1, capabilities: caps,
  parameters: [enumSpec("aspectRatio", ["1:1", "16:9"])],
};

async function render(locale, element, mocks = {}) {
  const env = await createDomTestEnv({ mocks: {
    "../../components/IconSet": new Proxy({}, { get: () => () => null }),
    "../../components/AppErrorBoundary": { AppErrorBoundary: ({ children }) => children },
    "./AssetLightbox": { AssetLightbox: () => null },
    "./ImageModelPicker": { ImageModelPicker: () => null },
    ...mocks,
  } });
  const { LocaleContext, useLocaleContextValue } = env.loadModule("@liveagent/ui/i18n");
  const host = document.body.appendChild(document.createElement("div"));
  const root = env.createRoot(host);
  const Provider = ({ children }) =>
    env.React.createElement(LocaleContext.Provider, { value: useLocaleContextValue(locale) }, children);
  const node = await element(env);
  await env.act(async () => root.render(env.React.createElement(Provider, null, node)));
  return {
    env, host,
    async close() { await env.act(async () => root.unmount()); host.remove(); env.cleanup(); },
  };
}
const labels = (host) => [...host.querySelectorAll("label")].map((label) => label.textContent.trim());

// [P2] parameterLabel looks up by key and ignores the backend label, so a parameter schema the
// user wrote in Settings → 高级：参数 schema (RunningHub workflow / custom targets) is relabeled
// whenever its key happens to be size/quality/background/watermark/...
test("adversarial: a user-authored parameter label is not replaced by the built-in key translation", async () => {
  let parsed;
  const view = await render("zh-CN", (env) => {
    const { parseImageParameters } = env.loadModule("@liveagent/ui/pages/settings/imageSettingsAdapter");
    // Accepted by the real settings parser, i.e. reachable from the settings editor.
    parsed = parseImageParameters(JSON.stringify([
      { key: "quality", label: "采样步数", type: "integer", required: false, minimum: 1, maximum: 50 },
      { key: "background", label: "背景色（十六进制）", type: "string", required: false },
      { key: "size", label: "输出边长", type: "string", required: false, enum: ["768", "1024"] },
    ]));
    const { TargetParameterForm } = env.loadModule("@liveagent/ui/features/image-studio/TargetParameterForm");
    return env.React.createElement(TargetParameterForm, {
      target: { ...openAI, id: "it_workflow", parameters: parsed }, values: {}, onChange: () => {},
    });
  });
  try {
    assert.deepEqual(parsed.map((p) => p.label), ["采样步数", "背景色（十六进制）", "输出边长"]);
    // Before the fix: ["画质", "背景色（十六进制）", "尺寸"] — the integer step count is shown as 画质.
    assert.deepEqual(labels(view.host), ["采样步数", "背景色（十六进制）", "输出边长"]);
  } finally {
    await view.close();
  }
});

// [P2] The composer's model-switch banner lists dropped parameters by raw key, right under the
// form that now shows the same parameters as 画质/背景.
test("adversarial: zh-CN model-switch banner names dropped parameters in Chinese", async () => {
  let controller;
  const view = await render("zh-CN", async (env) => {
    const { ImageStudioController } = env.loadModule("@liveagent/ui/features/image-studio/studioController");
    const storage = new Map();
    const client = {
      capabilities: async () => ({ supported: true }),
      listTargets: async () => [openAI, google],
      listProjects: async () => ({ items: [{ id: "archive", title: "archive", revision: 1 }] }),
      createProject: async () => ({ id: "archive", title: "archive", revision: 1 }),
      listJobs: async () => ({ items: [] }),
      getJob: async () => undefined,
      subscribe: async () => {},
      readAsset: async () => new Blob([], { type: "image/png" }),
    };
    controller = new ImageStudioController(client, "owner", "backend", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });
    await controller.start();
    controller.setTarget(openAI.id);
    controller.updateDraft({ parameters: { quality: "high", background: "transparent" } });
    controller.setTarget(google.id);
    const { ImageComposer } = env.loadModule("@liveagent/ui/features/image-studio/ImageComposer");
    return env.React.createElement(ImageComposer, { controller, view: controller.view });
  });
  try {
    assert.deepEqual([...controller.view.dropped], ["quality", "background"]);
    const banner = [...view.host.querySelectorAll('[role="alert"]')].find((e) => /切换模型后需要调整/.test(e.textContent));
    assert.ok(banner, "missing model-switch banner");
    // Before the fix: "切换模型后需要调整：quality、background。"
    assert.match(banner.textContent, /切换模型后需要调整：画质、背景。/);
  } finally {
    controller?.dispose();
    await view.close();
  }
});
