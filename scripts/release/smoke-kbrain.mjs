import assert from 'node:assert/strict';
import { verifyProviderControls } from './smoke-provider-controls.mjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { readLock, resolveTarget, defaultOutput } from './prepare-kbrain.mjs';
import { createTsModuleLoader } from '../../crates/agent-gui/test/helpers/load-ts-module.mjs';
const { parseKBrainHealth } = createTsModuleLoader().loadModule('@liveagent/ui/lib/kbrain/health.ts');
const lock = await readLock();
const binary = resolve(process.argv[2] ?? join(defaultOutput, `k-brain-${resolveTarget()}${process.platform === 'win32' ? '.exe' : ''}`));
const directory = await mkdtemp(join(tmpdir(), 'openagent-backend-smoke-'));
const token = randomUUID();
let child;
try {
  child = spawn(binary, ['backend', '-listen', '127.0.0.1:0', '-data-dir', directory, '-parent-stdio'], {
    windowsHide: true, stdio: ['pipe','pipe','ignore'],
    env: {...process.env, K_BRAIN_BACKEND_TOKEN:token, OPENAGENT_DATA_DIR:directory, OPENAGENT_BUILTIN_PROMPTS:'1'},
  });
  const base = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('K-brain startup timed out')), 30_000);
    let output = '';
    child.once('error', error => {clearTimeout(timer);reject(error);});
    child.once('exit', () => {clearTimeout(timer);reject(new Error('K-brain exited before readiness'));});
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-16384);
      const match = output.match(/k-brain backend listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {clearTimeout(timer);accept(match[1]);}
    });
  });
  const response = await fetch(`${base}/v1/health`, {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10_000)});
  assert.equal(response.status,200);
  const health = parseKBrainHealth(await response.json());
  assert.equal(health.legacy,false);
  assert.equal(health.build.version,lock.releaseTag);
  assert.equal(health.build.revision,lock.sourceRevision);
  assert.equal(health.build.channel,'stable');
  assert.equal(health.startupContract,1);
  assert.ok(!health.capabilities.ssh_manager,'Remote capabilities must remain disabled');
  await verifyProviderControls(base, token);
  const exited = once(child,'exit');
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 5_000);
  const [code] = await exited;
  clearTimeout(timer);
  assert.equal(code,0,'Backend must exit cleanly when its parent disconnects');
  console.log(`Verified K-brain ${health.build.version} (${health.build.channel}), revision ${health.build.revision}, compatible protocol and parent shutdown.`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {child.kill();await once(child,'exit');}
  await rm(directory,{recursive:true,force:true});
}