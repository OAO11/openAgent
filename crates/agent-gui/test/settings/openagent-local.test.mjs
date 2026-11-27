import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");

test("legacy remote and speech settings cannot reactivate removed features", () => {
  const defaults = settings.getDefaultSettings();
  const normalized = settings.normalizeSettings({
    ssh: { hosts: [{ id: "old-host", host: "example.invalid", username: "test" }] },
    remote: { enabled: true, gatewayUrl: "wss://example.invalid", token: "fixture" },
    stt: { enabled: true, provider: "aliyun_dashscope", providers: { aliyun_dashscope: { apiKey: "fixture" } } },
  });
  for (const key of ["ssh", "remote", "stt"]) assert.deepEqual(normalized[key], defaults[key]);
});
