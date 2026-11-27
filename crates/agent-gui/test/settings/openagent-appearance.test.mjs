import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test, after } from 'node:test';
import { createDomTestEnv } from '../helpers/dom-test-env.mjs';
const env = await createDomTestEnv();
after(() => env.cleanup());
const { readDocumentAppearanceKey, subscribeDocumentAppearance } = env.loadModule('@liveagent/ui/lib/appearance/documentTheme.ts');
const { observeDocumentThemeMode, readSandboxedUiTheme } = env.loadModule('@liveagent/ui/lib/sandboxed-ui/theme.ts');
const { resolveEditorTheme, createCatppuccinEditorTheme } = env.loadModule('@liveagent/ui/lib/appearance/editorTheme.ts');
const { normalizeSettings } = env.loadModule('@liveagent/ui/lib/settings/index.ts');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('palette changes notify mounted consumers without requiring a mode change', async () => {
  document.documentElement.className = '';
  delete document.documentElement.dataset.colorTheme;
  const changes = [], modes = [];
  const stop = subscribeDocumentAppearance(() => changes.push(readDocumentAppearanceKey()));
  const stopPanel = observeDocumentThemeMode(mode => modes.push(mode));
  document.documentElement.dataset.colorTheme = 'catppuccin';
  await tick();
  assert.deepEqual(changes, ['catppuccin:light']);
  assert.deepEqual(modes, ['light']);
  document.documentElement.classList.add('unrelated');
  await tick();
  assert.equal(changes.length, 1);
  document.documentElement.classList.add('dark');
  await tick();
  document.documentElement.dataset.colorTheme = 'default';
  await tick();
  assert.deepEqual(changes, ['catppuccin:light', 'catppuccin:dark', 'default:dark']);
  assert.deepEqual(modes, ['light', 'dark', 'dark']);
  stop(); stopPanel();
  document.documentElement.className = '';
  await tick();
  assert.equal(changes.length, 3, 'unsubscribe prevents callbacks');
});

test('editor registers both palettes once and can restore either default mode', () => {
  const defined = [];
  const registry = { defineTheme(name, data) { defined.push({ name, data }); } };
  assert.equal(resolveEditorTheme(registry, 'default', 'light'), 'vs');
  assert.equal(defined.length, 0);
  assert.equal(resolveEditorTheme(registry, 'catppuccin', 'light'), 'openagent-latte');
  assert.equal(resolveEditorTheme(registry, 'catppuccin', 'dark'), 'openagent-mocha');
  assert.equal(defined.length, 2);
  assert.equal(defined[0].data.colors['editor.background'], '#eff1f5');
  assert.equal(defined[1].data.colors['editor.background'], '#1e1e2e');
  assert.equal(resolveEditorTheme(registry, 'default', 'dark'), 'vs-dark');
  assert.equal(defined.length, 2);
});

test('sandbox themes use actual palette values and normalizer separates family from mode', () => {
  const root = document.documentElement;
  root.style.setProperty('--background', '240 21.0526% 14.9020%');
  root.style.setProperty('--foreground', '#cdd6f4');
  root.style.setProperty('--ui-color-1677ff', '#89b4fa');
  const theme = readSandboxedUiTheme('dark');
  assert.equal(theme.colors.background, '#1e1e2e');
  assert.equal(theme.colors.foreground, '#cdd6f4');
  assert.equal(theme.colors.accent, '#89b4fa');
  root.removeAttribute('style');
  for (const mode of ['light', 'dark', 'system']) {
    const settings = normalizeSettings({ theme: mode, colorTheme: 'catppuccin' });
    assert.equal(settings.theme, mode);
    assert.equal(settings.colorTheme, 'catppuccin');
  }
  assert.equal(normalizeSettings({ theme: 'dark', colorTheme: 'bad' }).colorTheme, 'default');
});

const bootScript = readFileSync(new URL('../../index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
for (const mode of ['light', 'dark', 'system']) {
  for (const osDark of [false, true]) {
    test(`boot applies Catppuccin before React, mode=${mode}, systemDark=${osDark}`, () => {
      let listener;
      const root = { dataset: {}, classList: { toggle(_name, dark) { root.dark = dark; } } };
      const media = { matches: osDark, addEventListener(_name, fn) { listener = fn; }, removeEventListener() { listener = undefined; } };
      const window = { matchMedia: () => media };
      const localStorage = { getItem: () => JSON.stringify({ theme: mode, colorTheme: 'catppuccin' }) };
      vm.runInNewContext(bootScript, { window, document: { documentElement: root }, localStorage });
      assert.equal(root.dataset.colorTheme, 'catppuccin');
      assert.equal(root.dark, mode === 'dark' || mode === 'system' && osDark);
      if (mode === 'system') {
        media.matches = !osDark; listener();
        assert.equal(root.dark, !osDark);
        window.__liveagentBootThemeCleanup();
        assert.equal(listener, undefined);
      } else assert.equal(listener, undefined);
    });
  }
}

test('boot tolerates malformed or absent local settings', () => {
  for (const saved of [null, '{bad', '{"theme":"dark","colorTheme":"invalid"}']) {
    const root = { dataset: {}, classList: { toggle(_name, dark) { root.dark = dark; } } };
    vm.runInNewContext(bootScript, { window: { matchMedia: () => ({ matches: true }) }, document: { documentElement: root }, localStorage: { getItem: () => saved } });
    assert.equal(root.dataset.colorTheme, 'default');
    assert.equal(root.dark, saved?.includes('dark') ?? false);
  }
});

function contrast(a, b) {
  const luminance = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(c => c <= .04045 ? c / 12.92 : ((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const [x,y] = [luminance(a), luminance(b)].sort((a,b)=>b-a); return (x+.05)/(y+.05);
}
test('both editor palettes keep normal text legible', () => {
  for (const mode of ['light', 'dark']) {
    const theme = createCatppuccinEditorTheme(mode);
    assert.ok(contrast(theme.colors['editor.foreground'], theme.colors['editor.background']) >= 4.5);
  }
});


test('Catppuccin semantic colors have readable text and terminal colors are concrete', () => {
  const { cssColorToHex } = env.loadModule('@liveagent/ui/lib/sandboxed-ui/theme.ts');
  const { readTerminalTheme } = env.loadModule('@liveagent/ui/lib/terminal/theme.ts');
  const css = readFileSync(new URL('../../../agent-ui/src/styles/catppuccin.css', import.meta.url), 'utf8');
  const blocks = [...css.matchAll(/:root[^{}]+\{([^}]+)\}/g)].map(([, body]) => new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()])));
  for (const values of blocks.slice(0,2)) {
    const hex = key => cssColorToHex(values.get(key));
    for (const [fg,bg] of [['foreground','background'], ['muted-foreground','background'], ['primary-foreground','primary'], ['card-foreground','card'], ['popover-foreground','popover'], ['success','success-surface'], ['warning','warning-surface'], ['destructive','destructive-surface'], ['info','info-surface']]) {
      assert.ok(contrast(hex(fg), hex(bg)) >= 4.5, `${fg} on ${bg}: ${contrast(hex(fg), hex(bg))}`);
    }
  }
  const terminal = blocks.at(-1);
  const style = { getPropertyValue: key => terminal.get(key.replace(/^--/, '')) ?? '' };
  for (const mode of ['light', 'dark']) {
    const colors = readTerminalTheme(mode, style);
    assert.equal(Object.keys(colors).length, 26);
    for (const color of Object.values(colors)) assert.match(color, /^#[a-f0-9]{6}([a-f0-9]{2})?$/i);
    assert.ok(contrast(colors.foreground, colors.background) >= 4.5);
  }
});
