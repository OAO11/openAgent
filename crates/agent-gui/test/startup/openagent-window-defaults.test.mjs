import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

// Platform window arrays replace (rather than merge) the base array in Tauri.
// Cover each override so a platform cannot silently restore the old dimensions.
for (const config of [
  "tauri.conf.json",
  "tauri.windows.conf.json",
  "tauri.windows.release.conf.json",
  "tauri.macos.conf.json",
]) {
  test(`${config} starts openAgent at 1159 by 857`, async () => {
    const data = JSON.parse(await readFile(new URL(`../../src-tauri/${config}`, import.meta.url), "utf8"));
    assert.ok(data.app.windows.length > 0);
    for (const window of data.app.windows) {
      if (config !== "tauri.macos.conf.json") assert.equal(window.title, "openAgent");
      assert.equal(window.width, 1159);
      assert.equal(window.height, 857);
      assert.ok(window.minWidth <= window.width);
      assert.ok(window.minHeight <= window.height);
    }
  });
}

test("previous native window state cannot override the startup defaults", async () => {
  const source = await readFile(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(source, /const WINDOW_STATE_FLAGS:[\s\S]*?=\s*tauri_plugin_window_state::StateFlags::empty\(\);/);
  assert.match(source, /\.with_state_flags\(WINDOW_STATE_FLAGS\)/);
});

test("workbench starts collapsed, can be opened, and is collapsed on the next mount", async () => {
  const env = await createDomTestEnv();
  const { React, act, createRoot } = env;
  const { useApplicationViewState } = env.loadModule("@liveagent/ui/application/useApplicationViewState.ts");
  const container = document.createElement("div");
  document.body.appendChild(container);
  let state;
  let root = createRoot(container);
  function Harness() {
    state = useApplicationViewState();
    return React.createElement("div", { "data-open": String(state.rightDockOpen) });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(state.rightDockOpen, false);
    await act(async () => state.setRightDockOpen(true));
    assert.equal(state.rightDockOpen, true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(state.rightDockOpen, false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
