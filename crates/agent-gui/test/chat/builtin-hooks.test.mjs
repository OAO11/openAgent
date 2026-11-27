import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const presetRoot = new URL("../../../agent-ui/src/lib/automation/presets/", import.meta.url);
const mocks = Object.fromEntries(["completion-sound.ps1", "project-check.ps1"].map(name => [`./presets/${name}?raw`, { __esModule: true, default: readFileSync(new URL(name, presetRoot), "utf8") }]));
const { BUILTIN_HOOK_PRESETS, builtinHookDefaults, builtinHookId } = createTsModuleLoader({ mocks }).loadModule("@liveagent/ui/lib/automation/builtinHooks.ts");
test("presets are opt-in, have stable identity, preserve full scripts and distinct source attribution", () => {
  assert.equal(BUILTIN_HOOK_PRESETS.length, 5);
  assert.equal(new Set(BUILTIN_HOOK_PRESETS.map(builtinHookId)).size, 5);
  for (const preset of BUILTIN_HOOK_PRESETS) {
    const value = builtinHookDefaults(preset, key => key);
    assert.equal(value.enabled, false);
    assert.equal(value.event, "agent_end");
    assert.equal(value.type, "command");
    assert.ok(value.timeoutMs <= 300000);
    assert.ok(value.script.length > 1000);
    assert.ok(value.description.includes(preset.source));
  }
});
const windows = process.platform === "win32";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "openagent-hook-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = join(root, "project's space 中文");
  mkdirSync(workdir);
  return { root, workdir };
}
function execute(id, fixture, changes = {}) {
  const script = builtinHookDefaults(BUILTIN_HOOK_PRESETS.find(p => p.id === id), key => key).script;
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    encoding: "utf8", timeout: 25000, windowsHide: true,
    env: { ...process.env, LIVEAGENT_WORKDIR: fixture.workdir, LOCALAPPDATA: fixture.root, ...changes },
  });
}
function report(fixture, id) {
  const dir = join(fixture.root, "openAgent", "hook-reports");
  return JSON.parse(readFileSync(join(dir, readdirSync(dir)[0], `${id}.json`), "utf8"));
}
test("missing workspace fails instead of executing checks in an unrelated directory", { skip: !windows }, t => {
  const f = fixture(t);
  assert.equal(execute("typecheck", f, { LIVEAGENT_WORKDIR: "" }).status, 2);
  assert.equal(report(f, "typecheck").status, "failed");
});
test("unsupported projects are honestly marked skipped", { skip: !windows }, t => {
  const f = fixture(t);
  assert.equal(execute("typecheck", f).status, 0);
  assert.equal(report(f, "typecheck").status, "skipped");
});
test("tests do not fall back to an uncontrolled watch script", { skip: !windows }, t => {
  const f = fixture(t);
  writeFileSync(join(f.workdir, "package.json"), JSON.stringify({ scripts: { test: "exit 9" } }));
  assert.equal(execute("test", f).status, 0);
  assert.equal(report(f, "test").status, "skipped");
});
test("project checks execute the configured command and propagate failure", { skip: !windows }, t => {
  const f = fixture(t);
  writeFileSync(join(f.workdir, "package.json"), JSON.stringify({ scripts: { "openagent:hook:typecheck": "node -e \"process.exit(7)\"", typecheck: "node -e \"process.exit(0)\"" } }));
  const result = execute("typecheck", f);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(report(f, "typecheck").status, "failed");
});
test("successful CI checks produce a passed report in paths with quotes and spaces", { skip: !windows }, t => {
  const f = fixture(t);
  writeFileSync(join(f.workdir, "package.json"), JSON.stringify({ scripts: { "test:ci": "node -e \"console.log('verified')\"" } }));
  const result = execute("test", f);
  assert.equal(result.status, 0, result.stderr);
  const saved = report(f, "test");
  assert.equal(saved.status, "passed"); assert.ok(saved.details.some(line => line.includes("verified")));
});
test("git checks detect staged and unstaged errors and leave working files unchanged", { skip: !windows }, t => {
  const f = fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd: f.workdir, encoding: "utf8", windowsHide: true });
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
  writeFileSync(join(f.workdir, "example.txt"), "base\n"); git("add", "example.txt"); git("commit", "-qm", "fixture");
  assert.equal(execute("git-diff", f).status, 0);
  const bad = "base\ntrailing whitespace   \n";
  writeFileSync(join(f.workdir, "example.txt"), bad);
  assert.equal(execute("git-diff", f).status, 1);
  git("add", "example.txt");
  assert.equal(execute("git-diff", f).status, 1);
  assert.equal(readFileSync(join(f.workdir, "example.txt"), "utf8"), bad);
});
