import { appendFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defaultLock, readLock } from "./prepare-kbrain.mjs";

const repository = "Stack-Cairn/K-brain";
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareStable(a, b) {
  if (!stable.test(a) || !stable.test(b)) throw new Error("Expected a stable release tag");
  const left = a.slice(1).split('.').map(BigInt), right = b.slice(1).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1; }
  return 0;
}
export function nextAppTag(tag) {
  if (!stable.test(tag)) throw new Error("Cannot increment a non-stable app release");
  const parts = tag.slice(1).split('.');
  parts[2] = String(BigInt(parts[2]) + 1n);
  return `v${parts.join('.')}`;
}

async function api(path, allowMissing = false) {
  const response = await fetch(`https://api.github.com/repos/${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "openAgent-backend-sync", ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub metadata unavailable: HTTP ${response.status}`);
  return response.json();
}

// A failed publication may leave a reserved tag. Reuse it only for identical
// sources; if upstream has advanced again, choose a new tag without rewriting it.
export async function selectAppTag(publishedTag, candidate, readTaggedLock) {
  let tag = nextAppTag(publishedTag);
  for (let attempts = 0; attempts < 100; attempts++, tag = nextAppTag(tag)) {
    const existing = await readTaggedLock(tag);
    if (existing === null || isDeepStrictEqual(existing, candidate)) return tag;
  }
  throw new Error("Too many reserved app release tags");
}

async function lockAtTag(tag) {
  const file = await api(`OAO11/openAgent/contents/scripts/release/kbrain.lock.json?ref=${encodeURIComponent(tag)}`);
  if (file.encoding !== 'base64') throw new Error('Cannot verify the tagged backend lock');
  return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
}

// Only complete stable releases are eligible. Preserve product patches and require
// pinned digests for both helpers on every supported desktop platform.
export async function updatedLock(lock, release, get = api) {
  const tag = release.tag_name;
  if (release.draft || release.prerelease || !stable.test(tag)) throw new Error("Expected a published stable K-brain release");
  const comparison = compareStable(tag, lock.releaseTag);
  if (comparison <= 0) return null;
  let ref = (await get(`${repository}/git/ref/tags/${tag}`)).object;
  for (let count = 0; ref?.type === "tag" && count < 4; count++) {
    if (!/^[a-f0-9]{40}$/.test(ref.sha)) throw new Error("Invalid annotated tag");
    ref = (await get(`${repository}/git/tags/${ref.sha}`)).object;
  }
  if (ref?.type !== "commit" || !/^[a-f0-9]{40}$/.test(ref.sha)) throw new Error("Release tag must resolve to a commit");
  const downloads = {};
  for (const [target, platform] of Object.entries(lock.platforms)) {
    const sha256 = {}, urls = {};
    for (const kind of ["backend", "computer"]) {
      const name = platform.assets[kind];
      const matches = release.assets?.filter(asset => asset.name === name) ?? [];
      const asset = matches[0];
      const expectedUrl = `https://github.com/${repository}/releases/download/${tag}/${name}`;
      if (matches.length !== 1 || asset.browser_download_url !== expectedUrl || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") || !(asset.size > 0)) {
        throw new Error(`Missing or unverified release asset: ${name}`);
      }
      sha256[kind] = asset.digest.slice(7);
      urls[kind] = expectedUrl;
    }
    downloads[target] = { sourceRevision: ref.sha, assets: platform.assets, sha256, urls };
  }
  return { ...lock, releaseTag: tag, sourceRevision: ref.sha, downloads };
}

export async function syncUpstream() {
  const lock = await readLock();
  const latest = await api(`${repository}/releases/latest`);
  const next = await updatedLock(lock, latest);
  const app = await api('OAO11/openAgent/releases/latest');
  // If a push succeeded but publication failed, retry the unpublished backend
  // on the next schedule instead of treating the updated main branch as shipped.
  const published = await lockAtTag(app.tag_name);
  const candidate = next ?? lock;
  const shipped = candidate.sourceRevision === published.sourceRevision && candidate.releaseTag === published.releaseTag && JSON.stringify(candidate.patches) === JSON.stringify(published.patches);
  if (shipped) {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'changed=false\n');
    console.log(`K-brain ${lock.releaseTag}: already current; no release needed.`);
    return;
  }
  const tag = await selectAppTag(app.tag_name, candidate, async tag => {
    const ref = await api(`OAO11/openAgent/git/ref/tags/${encodeURIComponent(tag)}`, true);
    return ref ? lockAtTag(tag) : null;
  });
  await writeFile(defaultLock, `${JSON.stringify(candidate, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=true\ntag=${tag}\nbackend=${candidate.releaseTag}\n`);
  console.log(`Pinned K-brain ${candidate.releaseTag} (${candidate.sourceRevision}); candidate openAgent ${tag}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncUpstream().catch(error => { console.error(error.message); process.exitCode = 1; });
}