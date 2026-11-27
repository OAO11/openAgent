import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
const base = new URL("../../../../resources/prompts/", import.meta.url);

test("all bundled roles preserve the complete pinned upstream Markdown", async () => {
  const manifest = JSON.parse(await readFile(new URL("agency-agents-sources.json", base), "utf8"));
  const templates = JSON.parse(await readFile(new URL("openagent-presets.json", base), "utf8"));
  assert.equal(templates.length, 8);
  assert.equal(manifest.templates.length, 8);
  for (const source of manifest.templates) {
    const bytes = await readFile(new URL(`agency-agents/${source.source}`, base));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    assert.equal([...bytes.toString("utf8")].length, source.characters);
    const template = templates.find(item => item.id === source.id);
    assert.equal(template.prompt, bytes.toString("utf8"), `${source.id} must not be summarized or truncated`);
  }
  const architect = templates.find(item => item.id === "openagent-architect");
  assert.equal([...architect.prompt].length, 6432);
});
