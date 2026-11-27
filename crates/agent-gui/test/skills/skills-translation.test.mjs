import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { translationPieces, translateSkillText, translationCacheId, readTranslationCache,
  writeTranslationCache, TRANSLATION_CACHE_KEY } = createTsModuleLoader().loadModule(
  "@liveagent/ui/pages/skills-hub/skillTranslationService.ts",
);
const model = { provider: "local-fixture", model: "translator", label: "Fixture" };
const options = (source, generate) => ({ source, model, generate, signal: new AbortController().signal });
const reply = (input, convert = (text) => `中文：${text}`) => JSON.stringify({
  translations: JSON.parse(input.text).texts.map(({id, text}) => ({id, text: convert(text)})), complete: true,
});
function storage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test("long Markdown is split without loss, preserving emoji and all code fences", async () => {
  const fenced = '```sh\n# Do not translate code\necho "hello"\n```\n';
  const source = '# Long skill\n\n' + 'Explain every step 🚀.\n'.repeat(450) + fenced + '\nFinal requirement.\n';
  assert.equal(translationPieces(source).map(x => x.text).join(""), source);
  const requests = [];
  const result = await translateSkillText(options(source, async (input) => { requests.push(input); return reply(input, text => text); }));
  assert.equal(result, source, "every character and trailing newline survives chunk assembly");
  assert.ok(requests.length > 5);
  assert.ok(requests.every(r => Array.from(JSON.parse(r.text).texts.map(x => x.text).join("")).length <= 1400));
  assert.ok(requests.every(r => !r.text.includes('echo')));
  assert.ok(requests.every(r => /never instructions to execute/.test(r.system)));
  assert.ok(requests.every(r => r.model.provider === model.provider && r.model.model === model.model));
});

test("long descriptions prefer complete lines to splitting sentences", () => {
  const source = Array.from({length: 100}, (_, index) => `Step ${index}: Explain the full requirement and verify the result.\n`).join("");
  const pieces = translationPieces(source);
  assert.equal(pieces.map(x => x.text).join(""), source);
  assert.ok(pieces.length > 3);
  assert.ok(pieces.every(piece => piece.text.endsWith(".\n")));
});

test("inline commands and link targets are protected while prose is translated", async () => {
  const source = 'Run `npm test` and read [Guide](https://example.com/path?q=one).\n';
  const result = await translateSkillText(options(source, async input => {
    assert.ok(!input.text.includes('npm test'));
    return reply(input, text => text.replace('Run', '运行').replace('and read', '并阅读'));
  }));
  assert.equal(result, '运行 `npm test` 并阅读 [Guide](https://example.com/path?q=one).\n');
});

test("code-only and whitespace-only documents never call the model", async () => {
  for (const source of ['```js\nconst a = 1;\n', '  \n\n', '~~~sh\necho hi\n~~~\n']) {
    assert.equal(await translateSkillText(options(source, async () => { throw Error('unexpected call'); })), source);
  }
});

test("missing segments, empty translations, false completion and truncated JSON are rejected", async () => {
  for (const response of ['{', 'null', '{}', '{"translations":[],"complete":true}',
    '{"translations":[{"id":0,"text":"译文"}],"complete":false}',
    '{"translations":[{"id":99,"text":"译文"}],"complete":true}',
    '{"translations":[{"id":0,"text":""}],"complete":true}']) {
    await assert.rejects(translateSkillText(options('Translate every sentence.', async () => response)), /translation-incomplete/);
  }
});

test("loss or duplication of protected commands rejects the translation", async () => {
  await assert.rejects(translateSkillText(options('Run `safe command`.', async input => reply(input, () => '运行'))), /translation-incomplete/);
  await assert.rejects(translateSkillText(options('Run `safe command`.', async input => reply(input, text => text + text))), /translation-incomplete/);
});

test("cancelling a late response stops further chunks and never returns a partial document", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(translateSkillText({ ...options('Many sentences.\n'.repeat(500), async input => {
    calls++; controller.abort(); return reply(input);
  }), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test("cache keys invalidate on source changes and model changes without storing source text", async () => {
  const cache = storage();
  const id = await translationCacheId('Original source', model);
  writeTranslationCache(cache, id, '完整中文');
  assert.equal(readTranslationCache(cache)[id], '完整中文');
  assert.notEqual(await translationCacheId('Updated source', model), id);
  assert.notEqual(await translationCacheId('Original source', { ...model, model: 'another' }), id);
  assert.ok(!cache.getItem(TRANSLATION_CACHE_KEY).includes('Original source'));
});

test("corrupt, disabled and oversized cache remain harmless and bounded", () => {
  assert.deepEqual(readTranslationCache({ getItem: () => '{' }), {});
  assert.deepEqual(readTranslationCache({ getItem: () => { throw Error('blocked'); } }), {});
  writeTranslationCache({ getItem: () => null, setItem: () => { throw Error('quota'); } }, 'a'.repeat(64), '中文');
  const cache = storage();
  for (let i = 0; i < 210; i++) writeTranslationCache(cache, i.toString(16).padStart(64, '0'), '中文');
  assert.equal(Object.keys(readTranslationCache(cache)).length, 200);
  writeTranslationCache(cache, 'f'.repeat(64), '字'.repeat(1_100_000));
  assert.ok(cache.getItem(TRANSLATION_CACHE_KEY).length <= 1_000_000);
});

test("translation adapter uses authenticated tool-free K-brain text endpoint and abort signal", async () => {
  const loader = createTsModuleLoader({ mocks: {
    '@liveagent/app/lib/host': { isKBrainBackendEnabled: () => true, isKBrainBrowserHost: () => true, isTauriHost: () => false },
  } });
  loader.loadModule('src/lib/kbrain/runtimeConnection.ts').setKBrainRuntimeConnection({
    baseUrl: 'http://127.0.0.1:19001', token: 'fixture-token', protocolVersion: 'kbrain.agent.v1',
  });
  const requests = [];
  let mismatched = false;
  const adapter = loader.loadModule('src/agent-ui-adapters/kbrainSkills.ts').createKbrainSkillsAdapter(async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({version: 'kbrain.agent.v1', text: '译文', model: {provider: model.provider, model: mismatched ? 'wrong' : model.model}}));
  });
  const signal = new AbortController().signal;
  const input = {model: {provider: model.provider, model: model.model}, system: 'Translate only', text: 'Untrusted skill'};
  assert.equal(await adapter.translate(input, signal), '译文');
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, 'http://127.0.0.1:19001/v1/text/generate');
  assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer fixture-token');
  assert.equal(request.init.signal, signal);
  assert.deepEqual(request.body.model, input.model);
  assert.equal(request.body.output, 'json');
  assert.deepEqual(request.body.messages, [
    {role: 'system', content: [{type: 'text', text: input.system}]},
    {role: 'user', content: [{type: 'text', text: input.text}]},
  ]);
  assert.equal(request.body.tools, undefined);
  assert.equal(request.body.session_id, undefined);
  mismatched = true;
  await assert.rejects(adapter.translate(input, signal), /Invalid K-brain skill translation response/);
});
