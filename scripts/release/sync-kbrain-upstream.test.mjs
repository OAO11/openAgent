import assert from 'node:assert/strict';
import test from 'node:test';
import { readLock } from './prepare-kbrain.mjs';
import { updatedLock, compareStable, nextAppTag, selectAppTag } from './sync-kbrain-upstream.mjs';
const lock = await readLock();
const tag='v99.1.2', revision='a'.repeat(40);
const release=()=>({tag_name:tag,draft:false,prerelease:false,assets:Object.values(lock.platforms).flatMap(p=>Object.values(p.assets).map(name=>({name,size:42,digest:`sha256:${'b'.repeat(64)}`,browser_download_url:`https://github.com/Stack-Cairn/K-brain/releases/download/${tag}/${name}`})))});
const direct=async()=>({object:{type:'commit',sha:revision}});
test('stable version comparisons and app increments use numeric components',()=>{
 assert.equal(compareStable('v0.107.48','v0.107.9'),1);
 assert.equal(nextAppTag('v0.1.9'),'v0.1.10');
 assert.throws(()=>nextAppTag('v0.1.2-beta.1'));
});
test('new release pins commit and every helper digest while preserving patches',async()=>{
 const next=await updatedLock(lock,release(),direct);
 assert.equal(next.sourceRevision,revision); assert.equal(next.releaseTag,tag);
 assert.deepEqual(next.patches,lock.patches);
 for(const download of Object.values(next.downloads)) {assert.equal(download.sourceRevision,revision);assert.equal(download.sha256.backend,'b'.repeat(64));}
 assert.notEqual(lock.sourceRevision,revision);
});
test('same release or downgrade is a no-op without reading a tag',async()=>{
 for(const tag_name of [lock.releaseTag,'v0.0.1']) assert.equal(await updatedLock(lock,{...release(),tag_name},()=>{throw Error('unexpected network');}),null);
});
test('rejects drafts, prereleases, missing assets, duplicate assets, absent hashes and foreign download URLs',async()=>{
 const cases=[{draft:true},{prerelease:true},{tag_name:'v99.1.2-beta.1'},{assets:[]}];
 for(const extra of cases) await assert.rejects(updatedLock(lock,{...release(),...extra},direct));
 for(const change of [asset=>{asset.digest=null;},asset=>{asset.browser_download_url='https://evil.invalid/binary';}]) {const r=release();change(r.assets[0]);await assert.rejects(updatedLock(lock,r,direct));}
 const duplicate=release();duplicate.assets.push(duplicate.assets[0]);await assert.rejects(updatedLock(lock,duplicate,direct));
});
test('annotated tags resolve to a commit and malformed tag chains fail closed',async()=>{
 let calls=0;
 const next=await updatedLock(lock,release(),async()=>({object:{type:++calls===1?'tag':'commit',sha:revision}}));
 assert.equal(calls,2);assert.equal(next.sourceRevision,revision);
 await assert.rejects(updatedLock(lock,release(),async()=>({object:{type:'tag',sha:revision}})));
 await assert.rejects(updatedLock(lock,release(),async()=>({object:{type:'commit',sha:'main'}})));
});
test('release retries reuse an identical reserved tag', async () => {
 const candidate={releaseTag:'v0.107.48',sourceRevision:revision};
 assert.equal(await selectAppTag('v0.1.1',candidate,async()=>({...candidate})),'v0.1.2');
 assert.equal(await selectAppTag('v0.1.1',candidate,async()=>null),'v0.1.2');
});
test('a newer backend skips reserved tags instead of overwriting or blocking', async () => {
 const seen=[];
 const selected=await selectAppTag('v0.1.1',lock,async tag=>{seen.push(tag);return tag==='v0.1.2'?{...lock,sourceRevision:'b'.repeat(40)}:null;});
 assert.equal(selected,'v0.1.3');assert.deepEqual(seen,['v0.1.2','v0.1.3']);
});
test('release reservation errors fail closed and retries are bounded', async () => {
 await assert.rejects(selectAppTag('v0.1.1',lock,async()=>{throw new Error('metadata unavailable');}),/metadata unavailable/);
 await assert.rejects(selectAppTag('v0.1.1',lock,async()=>({})),/Too many reserved/);
});
