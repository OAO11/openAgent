import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDomTestEnv } from '../helpers/dom-test-env.mjs';

for (const kind of ['plugin', 'mcp']) {
  test(`${kind} mounted iframe receives palette changes without changing light/dark mode`, async t => {
    const icon = () => null;
    const transcriptHost = { mcpApps: true, loadMcpAppHtml: async () => '<h1>Theme fixture</h1>' };
    const env = await createDomTestEnv({ mocks: {
      '@liveagent/ui/components/IconSet': new Proxy({}, { get: () => icon }),
      '@liveagent/ui/components/ui/button': { Button: icon },
      '@liveagent/ui/components/ui/empty-state': { EmptyState: icon },
      '@liveagent/ui/components/ui/toast-manager': { toast: { error() {}, warning() {}, success() {} } },
      '@liveagent/ui/components/sandboxed-ui/useSandboxedConfirm': { useSandboxedConfirm: () => ({ confirmTool: async () => false, confirmLink: async () => false, dialog: null }) },
      '@liveagent/ui/components/sandboxed-ui/SandboxedUiHostContext': { useSandboxedUiTranscriptHost: () => transcriptHost },
      '@liveagent/ui/i18n/index': { useLocale: () => ({ locale: 'en-US', t: key => key }) },
    } });
    const { React, act, createRoot } = env;
    const container = document.createElement('div');document.body.append(container);
    const root = createRoot(container);
    t.after(async () => { await act(async () => root.unmount()); container.remove();env.cleanup(); });
    let component;
    if (kind === 'plugin') {
      const { PluginPanelFrame } = env.loadModule('@liveagent/ui/components/sandboxed-ui/PluginPanelFrame.tsx');
      component = React.createElement(PluginPanelFrame, { client: { resolvePanelUrl: () => 'https://fixture.invalid/panel' }, plugin: { id: 'notes', name: 'Notes', version: '1.0.0', contributes: { tools: [] } }, panel: { id: 'main', title: 'Main', url: '/main', placement: 'settings' }, visible: true, workdir: '/fixture' });
    } else {
      const { McpAppView } = env.loadModule('@liveagent/ui/components/chat/assistant-bubble/McpAppView.tsx');
      component = React.createElement(McpAppView, { resource: { serverId: 'fixture', uri: 'ui://theme', url: 'https://fixture.invalid/app' }, toolName: 'theme', toolInput: {}, toolOutput: 'done', toolFailed: false });
    }
    await act(async () => root.render(component));
    const iframe = container.querySelector('iframe');assert.ok(iframe);
    const posted=[];
    iframe.contentWindow.postMessage = message => posted.push(message);
    const send = data => window.dispatchEvent(new window.MessageEvent('message', { source: iframe.contentWindow, data }));
    await act(async () => { send({ jsonrpc: '2.0', id: 1, method: kind === 'plugin' ? 'host.initialize' : 'ui/initialize', params: {} }); });
    if (kind === 'mcp') await act(async () => { send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }); });
    const method = kind === 'plugin' ? 'panel.themeChanged' : 'ui/notifications/host-context-changed';
    const baseline=posted.filter(p=>p.method===method).length;
    await act(async () => {
      document.documentElement.style.setProperty('--background', '#eff1f5');
      document.documentElement.dataset.colorTheme = 'catppuccin';
    });
    const changes=posted.filter(p=>p.method===method);
    assert.equal(changes.length,baseline+1);
    const background = kind === 'plugin' ? changes.at(-1).params.colors.background : changes.at(-1).params.styles.variables['--color-background-primary'];
    assert.equal(background,'#eff1f5');
    assert.equal(container.querySelector('iframe'),iframe);
    await act(async () => {
      document.documentElement.style.setProperty('--background', '#ffffff');
      document.documentElement.dataset.colorTheme='default';
    });
    assert.equal(posted.filter(p=>p.method===method).length,baseline+2);
    assert.equal(container.querySelector('iframe'),iframe);
  });
}
