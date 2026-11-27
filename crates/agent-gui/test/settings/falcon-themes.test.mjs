import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { code } from "../../node_modules/@streamdown/code/dist/index.js";
const loader = createTsModuleLoader();
const { FALCON_THEMES, getFalconTheme } = loader.loadModule("@liveagent/ui/lib/appearance/falconCatalog.ts");
const { getFalconPalette } = loader.loadModule("@liveagent/ui/lib/appearance/falcon.ts");
const { normalizeColorTheme, resolveEffectiveTheme } = loader.loadModule("@liveagent/ui/lib/settings/themeAndMemory.ts");
const { resolveEditorTheme } = loader.loadModule("@liveagent/ui/lib/appearance/editorTheme.ts");
const { getMarkdownThemes } = loader.loadModule("@liveagent/ui/lib/appearance/markdownThemes.ts");
const boot = readFileSync(new URL("../../index.html", import.meta.url), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
function contrast(a,b) {
  const luminance = color => [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const [hi,lo] = [luminance(a),luminance(b)].sort((a,b)=>b-a); return (hi+.05)/(lo+.05);
}
test("catalog contains all 28 upstream themes with Chinese labels and distinct Islands surfaces", () => {
  assert.equal(FALCON_THEMES.length,28);
  assert.equal(new Set(FALCON_THEMES.map(t=>t.id)).size,28);
  assert.equal(FALCON_THEMES.filter(t=>t.mode==="light").length,16);
  assert.equal(FALCON_THEMES.filter(t=>t.variant==="islands").length,14);
  assert.equal(getFalconPalette("falcon-dark-coffee").background,"#2c2122");
  assert.equal(getFalconPalette("falcon-pink").background,"#fdf5f6");
  assert.equal(getFalconPalette("falcon-islands-pink").rail,"#ffe9ea");
  for (const id of ["__proto__", "falcon-fake", null, {}]) { assert.equal(getFalconTheme(id),undefined);assert.equal(normalizeColorTheme(id),"default"); }
});
for (const theme of FALCON_THEMES) test(`${theme.id}: restore, boot, embedded colors and readability`, () => {
  const p=getFalconPalette(theme.id);
  assert.equal(normalizeColorTheme(theme.id),theme.id);
  for (const mode of ["light","dark","system"]) {
    assert.equal(resolveEffectiveTheme(mode,theme.id),theme.mode);
    const root={dataset:{},classList:{toggle(_key,dark){root.dark=dark;}}};
    vm.runInNewContext(boot,{document:{documentElement:root},window:{matchMedia:()=>({matches:theme.mode!=="dark"})},localStorage:{getItem:()=>JSON.stringify({colorTheme:theme.id,theme:mode})}});
    assert.equal(root.dataset.colorTheme,theme.id);assert.equal(root.dark,theme.mode==="dark");
  }
  for(const bg of [p.background,p.rail,p.hover,p.selection]) assert.ok(contrast(p.foreground,bg)>=4.5,`UI text contrast ${contrast(p.foreground,bg)}`);
  assert.ok(contrast(p.accentForeground,p.accent)>=4.5);
  assert.ok(contrast(p.editor.foreground,p.editor.background)>=4.5);
  assert.ok(contrast(p.terminal.foreground,p.terminal.background)>=4.5);
  assert.equal(Object.keys(p.terminal).length,26);
  const definitions=[];const editor={defineTheme(name,data){definitions.push({name,data});}};
  const name=resolveEditorTheme(editor,theme.id,theme.mode);
  resolveEditorTheme(editor,theme.id,theme.mode);
  assert.equal(definitions.length,1);assert.equal(name,`openagent-${theme.id}`);
  assert.equal(definitions[0].data.colors["editor.background"],p.editor.background);
  const pair=getMarkdownThemes(theme.id);assert.equal(pair,getMarkdownThemes(theme.id));
  assert.equal(pair[0].name,name);assert.equal(pair[0].colors["editor.background"],p.editor.background);
});
test("real Streamdown highlighter accepts custom Falcon TextMate themes", async () => {
  for(const id of ["falcon-dark-coffee","falcon-islands-pink","falcon-dark-violet"]) {
    const themes=getMarkdownThemes(id);
    const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Falcon highlighting timed out")),15000);const finish=result=>{clearTimeout(timer);resolve(result);};const immediate=code.highlight({code:"const message = 'openAgent'; // theme",language:"javascript",themes},finish);if(immediate)finish(immediate);});
    assert.equal(result.bg,`${getFalconPalette(id).editor.background};--shiki-dark-bg:${getFalconPalette(id).editor.background}`);assert.ok(result.tokens.flat().length>0);
  }
});
