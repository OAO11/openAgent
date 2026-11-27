import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
const root = fileURLToPath(new URL("../../src-tauri/prompt/skills/", import.meta.url));
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
test("development catalog covers all requested stages and has unique discoverable names", () => {
  assert.equal(catalog.skills.length, 16);
  assert.equal(new Set(catalog.skills.map(s => s.name)).size, 16);
  for (const stage of ["planning", "architecture", "backend", "frontend", "database", "testing", "performance", "deployment"]) {
    assert.ok(catalog.skills.some(s => s.stage === stage), stage);
  }
});
for (const skill of catalog.skills) {
  test(`${skill.name}: full original sources, license, local references and ownership survive packaging`, () => {
    const dir = join(root, skill.name);
    const body = readFileSync(join(dir, "SKILL.md"), "utf8");
    assert.ok(body.startsWith(`---\nname: ${skill.name}\n`));
    assert.ok(body.includes(skill.title));
    assert.ok(body.length > 900);
    const marker = JSON.parse(readFileSync(join(dir, "_openagent_builtin.json"), "utf8"));
    assert.equal(marker.owner, "openAgent"); assert.equal(marker.skill, skill.name);
    for (const file of skill.sources) {
      const bytes = readFileSync(join(dir, file.localPath));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.localPath);
      assert.match(file.revision, /^[a-f0-9]{40}$/);
      assert.ok(existsSync(join(dir, file.licenseFile)), file.licenseFile);
    }
    const embedded = readFileSync(join(root, "../../../src-tauri/src/services/skills/builtin_catalog.rs"), "utf8");
    assert.ok(embedded.includes(`name: "${skill.name}"`));
    for (const file of skill.sources) assert.ok(embedded.includes(`${skill.name}/${file.localPath}`));
  });
}
