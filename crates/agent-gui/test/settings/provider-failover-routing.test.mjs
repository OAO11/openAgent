import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const loader = createTsModuleLoader();
const { normalizeSettings } = loader.loadModule("src/lib/settings/index.ts");
const { kBrainSettingsUpdateFromAppSettings, kBrainSettingsUpdateForFailover, kBrainSettingsUpdateForMissingInputModalities } = loader.loadModule("src/lib/kbrain/providerSettings.ts");
const providers = ["selected", "casa"].map(id => ({ id, name: id, type: "codex", baseUrl: "http://fixture.invalid", apiKey: "", apiKeyConfigured: true, models: [{ id: "shared" }], activeModels: ["shared"] }));

test("backend updates explicitly disable failover by default and preserve same-provider retry policy", () => {
  const settings = normalizeSettings({ customProviders: providers });
  const update = kBrainSettingsUpdateFromAppSettings(settings, settings);
  for (const provider of update.providers) {
    assert.equal(provider.retryPolicy.failover.enabled, false);
    assert.equal(provider.retryPolicy.failover.maxSwitches, 0);
    assert.deepEqual(provider.retryPolicy.failover.queue, []);
    assert.equal(provider.retryPolicy.mode, "default");
    assert.equal("apiKey" in provider, false);
  }
});

test("enabled failover sends only the configured queue, and disabling it clears routing permission", () => {
  const initial = normalizeSettings({ customProviders: providers });
  const next = normalizeSettings({ ...initial, customProviders: [{ ...providers[0], retryPolicy: { mode: "custom", maxRetries: 2 } }, providers[1]], modelFailover: { codex: { enabled: true, queue: ["casa"], maxSwitches: 2, failureThreshold: 3, cooldownSeconds: 45 } } });
  const wired = kBrainSettingsUpdateFromAppSettings(initial, next).providers[0];
  assert.deepEqual(wired.retryPolicy, { mode: "custom", maxRetries: 2, failover: { enabled: true, queue: ["casa"], maxSwitches: 2, failureThreshold: 3, cooldownSeconds: 45 } });
  const disabled = normalizeSettings({ ...next, modelFailover: { codex: { ...next.modelFailover.codex, enabled: false } } });
  const off = kBrainSettingsUpdateFromAppSettings(next, disabled).providers[0].retryPolicy.failover;
  assert.equal(off.enabled, false);
  assert.equal(off.maxSwitches, 0);
  assert.deepEqual(off.queue, ["casa"]);
});

test("startup reconciles saved local failover once without changing provider selection", () => {
  const settings = normalizeSettings({ customProviders: providers, modelFailover: { codex: { enabled: true, queue: ["casa"] } } });
  const document = { providers };
  const update = kBrainSettingsUpdateForFailover(document, settings);
  assert.equal(update.providers.length, 2);
  assert.equal(update.defaultProvider, undefined);
  assert.equal(update.deleteProviders, undefined);
  assert.equal(kBrainSettingsUpdateForFailover({ providers: update.providers }, settings), undefined);
  const reordered = structuredClone(update.providers);
  for (const provider of reordered) provider.retryPolicy.failover = Object.fromEntries(Object.entries(provider.retryPolicy.failover).reverse());
  assert.equal(kBrainSettingsUpdateForFailover({ providers: reordered }, settings), undefined);
  const defaults = normalizeSettings({ customProviders: providers });
  assert.equal(kBrainSettingsUpdateForFailover(document, defaults), undefined);
  assert.equal(kBrainSettingsUpdateForFailover({ providers: update.providers }, defaults).providers[0].retryPolicy.failover.enabled, false);
});


test("catalog metadata reconciliation does not overwrite backend routing policy", () => {
  const provider = { ...providers[0], models: [{ id: "gpt-4o" }], retryPolicy: { mode: "off" } };
  const update = kBrainSettingsUpdateForMissingInputModalities([provider]);
  assert.ok(update);
  assert.equal("retryPolicy" in update.providers[0], false);
});
