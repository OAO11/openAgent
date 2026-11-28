import assert from "node:assert/strict";
import { createServer } from "node:http";

// The caller owns an isolated backend data directory. All upstreams are loopback fixtures.
export async function verifyProviderRouting(baseUrl, token) {
  const call = async (path, method, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, text: await response.text() };
  };
  for (const api of ["openai-responses", "openai-completions"]) {
    const calls = [];
    let rejectSelected = false;
    const servers = [];
    const ids = ["selected", "casa", "unlisted"].map(name => `routing-${api}-${name}`);
    try {
      for (const id of ids) {
        const server = createServer(async (request, response) => {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          if (request.url?.endsWith("/models")) {
            response.end(JSON.stringify({ data: [{ id: "shared-model" }] }));
            return;
          }
          calls.push(id);
          assert.equal(request.headers.authorization, `Bearer fixture-${id}`);
          const body = JSON.parse(Buffer.concat(chunks).toString());
          assert.equal(body.model, "shared-model");
          if (id === ids[0] && rejectSelected) {
            response.writeHead(403, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: { message: "This account only allows Codex official clients", type: "forbidden_error" } }));
            return;
          }
          const result = api === "openai-responses"
            ? { id: "fixture", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1 } }
            : { choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
          if (body.stream !== true) {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify(result));
          } else {
            response.writeHead(200, { "Content-Type": "text/event-stream" });
            if (api === "openai-responses") {
              response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}\n\n`);
              response.write(`data: ${JSON.stringify({ type: "response.completed", response: result })}\n\n`);
            } else {
              response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
            }
            response.end();
          }
        });
        servers.push(server);
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      }
      const providers = ids.map((id, index) => ({
        id, name: id, type: "codex", api, requestFormat: api, enabled: true,
        baseUrl: `http://127.0.0.1:${servers[index].address().port}/v1`, apiKey: `fixture-${id}`,
        activeModels: ["shared-model"], retryPolicy: { mode: "off" },
        models: [{ id: "shared-model", contextWindow: 200000, maxOutputTokens: 1024, limitsSource: "user" }],
      }));
      const saved = await call("/v1/settings", "PUT", { providers, defaultProvider: ids[1], defaultModel: "shared-model" });
      assert.equal(saved.status, 200, saved.text);
      const generate = async (path, selected = ids[0]) => {
        calls.length = 0;
        return call(path, "POST", { ...(path === "/v1/generate" ? { stream: true } : {}), model: { provider: selected, model: "shared-model" }, messages: [{ role: "user", content: [{ type: "text", text: "fixture" }] }] });
      };
      const policy = async failover => {
        const saved = await call("/v1/settings", "PUT", { providers: [{ id: ids[0], retryPolicy: { mode: "off", failover } }] });
        assert.equal(saved.status, 200, saved.text);
      };
      for (const path of ["/v1/text/generate", "/v1/generate"]) {
        const healthy = await generate(path);
        assert.equal(healthy.status, 200, healthy.text);
        assert.deepEqual(calls, [ids[0]], "Explicit selection must override backend default and same-model providers");
        await generate(path, ids[1]);
        assert.deepEqual(calls, [ids[1]], "Switching selection must switch endpoint and credentials");
      }
      rejectSelected = true;
      // Enough failures to open the breaker: it still cannot redirect a default-off request.
      for (let index = 0; index < 6; index++) {
        const rejected = await generate(index % 2 ? "/v1/generate" : "/v1/text/generate");
        assert.deepEqual(calls, [ids[0]], "A 403 must not authorize implicit provider switching");
        if (index % 2) assert.match(rejected.text, /"type":"request.failed"/);
        else assert.equal(rejected.status, 502, rejected.text);
      }
      rejectSelected = false;
      await generate("/v1/text/generate"); // Clear the previous breaker with a healthy selected request.
      rejectSelected = true;
      await policy({ enabled: true, queue: [ids[1]], maxSwitches: 1 });
      for (const path of ["/v1/text/generate", "/v1/generate"]) {
        const recovered = await generate(path);
        assert.equal(recovered.status, 200, recovered.text);
        assert.deepEqual(calls, [ids[0], ids[1]], "Only an explicit queue may receive fallback requests");
      }
      await policy({ enabled: false, queue: [ids[1]], maxSwitches: 3 });
      await generate("/v1/generate");
      assert.deepEqual(calls, [ids[0]], "Disabling failover must take effect immediately");
      await policy({ enabled: true, queue: [], maxSwitches: 3 });
      await generate("/v1/text/generate");
      assert.deepEqual(calls, [ids[0]], "An empty queue must not add unlisted providers");
      console.log(`Verified ${api}: selected endpoint/key, 403 isolation, circuit isolation, opt-in queue and disable.`);
    } finally {
      await Promise.all(servers.map(server => new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
      })));
    }
  }
}
