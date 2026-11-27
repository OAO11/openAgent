import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as streamdown from '../../node_modules/streamdown/dist/index.js';
import remarkBreaks from '../../node_modules/remark-breaks/index.js';
import { createDomTestEnv } from '../helpers/dom-test-env.mjs';

test('mounted Markdown passes the selected family to the real Streamdown code renderer', async t => {
  const requests=[];
  const code={ name:'shiki',type:'code-highlighter',getThemes:()=>['github-light','github-dark'],supportsLanguage:()=>true,getSupportedLanguages:()=>['javascript'],highlight(options){requests.push(options);return {tokens:[],fg:'#111111',bg:'#ffffff'};} };
  const env=await createDomTestEnv({mocks:{
    streamdown, 'remark-breaks':{__esModule:true,default:remarkBreaks},
    '@streamdown/code':{code}, '@streamdown/math':{math:undefined},'@streamdown/cjk':{cjk:undefined},
    '@liveagent/app/shims/tauriOpener':{openUrl(){}},
    '@liveagent/ui/components/IconSet':new Proxy({},{get:()=>()=>null}),
    '@liveagent/ui/i18n/index':{useLocale:()=>({t:key=>key})},
  }});
  const {React,act,createRoot}=env;
  const {Markdown}=env.loadModule('@liveagent/ui/components/Markdown.tsx');
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  t.after(async()=>{await act(async()=>root.unmount());container.remove();env.cleanup();});
  const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await act(async()=>{await new Promise(r=>setTimeout(r,15));});}assert.ok(predicate(),'highlighter did not receive expected themes');};
  await act(async()=>root.render(React.createElement(Markdown,{content:'Keep this paragraph.\n\n```javascript\nconst answer = 42;\n```'})));
  await wait(()=>requests.some(r=>r.themes.join(',')==='github-light,github-dark'));
  const paragraph=container.querySelector('p');
  await act(async()=>{document.documentElement.dataset.colorTheme='catppuccin';});
  await wait(()=>requests.some(r=>r.themes.join(',')==='catppuccin-latte,catppuccin-mocha'));
  assert.equal(container.querySelector('p'),paragraph,'changing code colors must not remount the text');
  await act(async()=>{document.documentElement.dataset.colorTheme='falcon-dark-coffee';});
  await wait(()=>requests.some(r=>r.themes[0]?.name==='openagent-falcon-dark-coffee'));
  assert.equal(container.querySelector('p'),paragraph);
  await act(async()=>{document.documentElement.dataset.colorTheme='default';});
  assert.equal(container.querySelector('p'),paragraph);
});
