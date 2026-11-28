import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createTsModuleLoader } from "../../crates/agent-gui/test/helpers/load-ts-module.mjs";

// Exercise the real UI preset -> settings -> binary -> HTTP path, entirely on localhost.
export async function verifyCodexCompatibility(baseUrl, token) {
  const { buildCliIdentityHeaders } = createTsModuleLoader().loadModule("@liveagent/ui/lib/providers/customHeaders.ts");
  const identity = buildCliIdentityHeaders("codex");
  const calls = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push({ headers: request.headers, body });
    const result = { id: "fixture", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 3, output_tokens: 1 } };
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}\n\n`);
      response.end(`data: ${JSON.stringify({ type: "response.completed", response: result })}\n\n`);
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const call = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    assert.equal(response.status, 200, "Fixture generation must succeed");
    assert.ok(!text.includes('"type":"request.failed"'), "Fixture generation must complete");
    return text;
  };
  const save = async (provider) => {
    const response = await fetch(`${baseUrl}/v1/settings`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ providers: [provider] }), signal: AbortSignal.timeout(15_000) });
    await response.text();
    assert.equal(response.status, 200);
  };
  const generate = (path) => call(path, { ...(path === "/v1/generate" ? { stream: true } : {}), model: { provider: "codex-fixture", model: "codex-fixture-model" }, messages: [{ role: "system", content: [{ type: "text", text: "Preserve openAgent instructions." }] }, { role: "user", content: [{ type: "text", text: "fixture" }] }] });
  try {
    await save({ id: "codex-fixture", type: "codex", api: "openai-responses", enabled: true, baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fixture-codex-only", customHeaders: identity, activeModels: ["codex-fixture-model"], models: [{ id: "codex-fixture-model", contextWindow: 200000, maxOutputTokens: 128 }], retryPolicy: { mode: "off", failover: { enabled: false } } });
    for (const path of ["/v1/text/generate", "/v1/generate"]) {
      calls.length = 0;
      await generate(path);
      assert.equal(calls.length, 1);
      const { headers, body } = calls[0];
      for (const { key, value } of identity) assert.equal(headers[key.toLowerCase()], value);
      assert.equal(headers.authorization, "Bearer fixture-codex-only");
      for (const key of ["session-id", "thread-id", "x-client-request-id", "x-codex-window-id"]) assert.match(headers[key], /^[a-f0-9-]{36}$/);
      assert.equal(headers["x-client-request-id"], headers["thread-id"]);
      assert.equal(headers.accept, "text/event-stream");
      assert.equal(body.client_metadata["x-codex-window-id"], headers["x-codex-window-id"]);
      assert.equal(body.instructions, "Preserve openAgent instructions.");
      assert.equal(body.input.length, 1);
      assert.equal(body.input[0].role, "user");
      assert.equal(body.stream, true);
      assert.equal(body.store, false);
    }
    await save({ id: "codex-fixture", customHeaders: [] });
    calls.length = 0;
    await generate("/v1/text/generate");
    assert.equal(calls[0].headers["x-codex-window-id"], undefined);
    assert.equal(calls[0].body.instructions, undefined);
    assert.equal(calls[0].body.stream, false);
    assert.equal(calls[0].body.input[0].role, "system");
    console.log("Verified Codex preset, runtime/session headers, prompt preservation, SSE completion, credentials and immediate opt-out.");
  } finally {
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
}
