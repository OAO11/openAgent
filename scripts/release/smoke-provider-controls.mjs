import assert from "node:assert/strict";
import { createServer } from "node:http";

// Called only against smoke-kbrain's isolated temporary data directory.
export async function verifyProviderControls(baseUrl, token) {
  const calls = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.url?.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "fixture-opus" }] }));
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push({ body, beta: request.headers["anthropic-beta"] ?? "" });
    if (body.stream !== true) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "fixture", type: "message", role: "assistant", model: body.model,
        content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "message_start", message: { usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const call = async (path, method = "GET", body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    return { status: response.status, text, json: () => JSON.parse(text) };
  };
  const save = async (provider) => {
    const response = await call("/v1/settings", "PUT", { providers: [provider] });
    assert.equal(response.status, 200, response.text);
    assert.ok(!response.text.includes("fixture-only-key"), "Settings must not expose credentials");
    return response.json();
  };
  const generate = (path = "/v1/text/generate") => call(path, "POST", {
    model: { provider: "fixture", model: "fixture-opus" },
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  });
  try {
    const disabled = await save({
      id: "fixture", type: "claude_code", api: "anthropic-messages", enabled: false,
      baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiKey: "fixture-only-key",
      customHeaders: [{ key: "Anthropic-Beta", value: "existing-beta" }], activeModels: ["fixture-opus"],
      models: [{ id: "fixture-opus", supports1M: true, contextWindow: 1000000, maxOutputTokens: 1024, limitsSource: "user" }],
    });
    assert.equal(disabled.providers[0].enabled, false);
    assert.equal(disabled.providers[0].models[0].supports1M, true);
    assert.equal(disabled.models.length, 0);
    const rejected = await generate();
    assert.equal(rejected.status, 400, rejected.text);
    assert.equal((await generate("/v1/generate")).status, 400);
    assert.equal(calls.length, 0);
    const enabled = await save({ id: "fixture", enabled: true });
    assert.equal(enabled.providers[0].apiKeyConfigured, true);
    assert.equal(enabled.models[0].contextWindow, 1000000);
    const generated = await generate();
    assert.equal(generated.status, 200, generated.text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.model, "fixture-opus");
    assert.equal(calls[0].beta, "existing-beta,context-1m-2025-08-07");
    const streamed = await generate("/v1/generate");
    assert.equal(streamed.status, 200, streamed.text);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].beta, "existing-beta,context-1m-2025-08-07");
    await save({ id: "fixture", models: [{ id: "fixture-opus", supports1M: false, contextWindow: 200000 }] });
    assert.equal((await generate()).status, 200);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].beta, "existing-beta");
    const reloaded = (await call("/v1/settings")).json();
    assert.equal(reloaded.providers[0].models[0].supports1M, false);
    console.log("Verified shipped backend provider toggle, preserved credentials, 1M request opt-in and opt-out.");
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  }
}
